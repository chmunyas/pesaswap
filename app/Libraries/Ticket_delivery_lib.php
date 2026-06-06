<?php

namespace App\Libraries;

use app\Libraries\Email_lib;
use app\Libraries\Sms_lib;
use App\Models\Ticket;
use Throwable;

/**
 * Ticket_delivery_lib — fan-out delivery of newly issued tickets to the
 * holder via email and / or SMS, with full audit + retry metadata recorded
 * in ticket_delivery_attempts.
 *
 * Invocation contract:
 *   - Called from Ticket_issuer post-issue (sale-driven path) and from
 *     TicketsController::ticketIssue (manual issuance) when the operator
 *     supplies a recipient email/phone.
 *   - NEVER throws back into the caller — issuance must succeed even if
 *     delivery fails. Failed attempts are logged + queued (status='failed')
 *     so a future Phase 4 worker can retry.
 *
 * Templates live in app_config (ticket_delivery_email_subject,
 * ticket_delivery_sms_template) and support `{{title}}`, `{{code}}`,
 * `{{url}}` substitution.
 */
class Ticket_delivery_lib
{
    public function __construct()
    {
        helper(['file']);
    }

    /**
     * Dispatch all enabled delivery channels for a single newly-issued
     * ticket. Returns a list of [channel => result] pairs for observability.
     *
     * @param object  $ticket Hydrated tickets row (joined with product columns is fine).
     * @param ?string $email  Recipient email (caller-supplied or customer record).
     * @param ?string $phone  Recipient phone (caller-supplied or customer record).
     *
     * @return array<string, array{status: string, error?: string}>
     */
    public function dispatch(object $ticket, ?string $email, ?string $phone): array
    {
        $db = db_connect();
        if (! $db->tableExists('ticket_delivery_attempts')) {
            return ['skipped' => ['status' => 'migration_missing']];
        }

        $product = $this->loadProduct($ticket);
        if ($product === null) {
            return ['skipped' => ['status' => 'product_missing']];
        }

        $url  = service('qr_lib')->build_redemption_url((string) $ticket->code);
        $vars = $this->renderVars($product, $ticket, $url);

        $results = [];

        if ($email !== null && $email !== '' && $this->channelEnabled('email')) {
            $results['email'] = $this->sendEmail($ticket, $email, $product, $vars, $url);
        }
        if ($phone !== null && $phone !== '' && $this->channelEnabled('sms')) {
            $results['sms'] = $this->sendSms($ticket, $phone, $product, $vars);
        }

        if ($results === []) {
            return ['skipped' => ['status' => 'no_channel_or_recipient']];
        }

        return $results;
    }

    /**
     * Retry a previously-failed delivery attempt. Returns ['status' => ...].
     */
    public function retry(int $deliveryId): array
    {
        $db  = db_connect();
        $row = $db->table('ticket_delivery_attempts')
            ->where('delivery_id', $deliveryId)
            ->get()
            ->getRowArray();
        if ($row === null) {
            return ['status' => 'not_found'];
        }
        if ((string) $row['status'] === 'sent') {
            return ['status' => 'already_sent'];
        }

        $ticket = $db->table('tickets')
            ->select('tickets.*, ticket_products.title, ticket_products.brand_name')
            ->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left')
            ->where('ticket_id', (int) $row['ticket_id'])
            ->get()
            ->getRow();
        if ($ticket === null) {
            return ['status' => 'ticket_missing'];
        }

        $email   = (string) $row['channel'] === 'email' ? (string) $row['address'] : null;
        $phone   = (string) $row['channel'] === 'sms' ? (string) $row['address'] : null;
        $results = $this->dispatch($ticket, $email, $phone);
        $key     = $email !== null ? 'email' : 'sms';

        return $results[$key] ?? ['status' => 'no_attempt_made'];
    }

    /**
     * Retry an existing delivery row IN PLACE — increments attempts,
     * updates last_attempt_at, and re-sends via email/SMS without
     * inserting a new ticket_delivery_attempts row. Returns
     * ['status' => 'sent'|'failed'|'skipped', 'attempts' => N, ...]
     *
     * Called from spark `tickets:retry-deliveries`. The companion
     * `tickets:cleanup` command flips status='failed' to 'bounced' once
     * attempts >= max_retries OR the row has been stuck >= failed_ttl
     * hours, so a healthy retry loop converges:
     *     queued/failed → retry → sent (done)
     *                  → failed → retry → sent
     *                  → failed → ... → bounced (cleanup)
     */
    public function retryRow(int $deliveryId): array
    {
        $db  = db_connect();
        $row = $db->table('ticket_delivery_attempts')
            ->where('delivery_id', $deliveryId)
            ->get()
            ->getRowArray();
        if ($row === null) {
            return ['status' => 'not_found'];
        }
        if (in_array((string) $row['status'], ['sent', 'bounced'], true)) {
            return ['status' => 'skipped', 'reason' => 'terminal'];
        }

        $ticket = $db->table('tickets')
            ->select('tickets.*, ticket_products.title, ticket_products.brand_name')
            ->join('ticket_products', 'ticket_products.ticket_product_id = tickets.ticket_product_id', 'left')
            ->where('ticket_id', (int) $row['ticket_id'])
            ->where('tickets.deleted', 0)
            ->get()
            ->getRow();
        if ($ticket === null) {
            // Ticket is gone — bounce this attempt so cleanup doesn't keep retrying.
            $db->table('ticket_delivery_attempts')
                ->where('delivery_id', $deliveryId)
                ->update([
                    'status'     => 'bounced',
                    'last_error' => 'Ticket no longer exists.',
                ]);

            return ['status' => 'bounced', 'reason' => 'ticket_missing'];
        }

        // Increment attempts on the existing row BEFORE sending, so even
        // a hard crash during send still bumps the counter and prevents
        // an infinite hot-loop on a permanently failing channel.
        $newAttempts = ((int) ($row['attempts'] ?? 0)) + 1;
        $db->table('ticket_delivery_attempts')
            ->where('delivery_id', $deliveryId)
            ->update([
                'attempts'        => $newAttempts,
                'last_attempt_at' => date('Y-m-d H:i:s'),
                'status'          => 'queued',
            ]);

        $channel = (string) $row['channel'];
        $address = (string) $row['address'];
        $product = $this->loadProduct($ticket);
        if ($product === null) {
            $db->table('ticket_delivery_attempts')
                ->where('delivery_id', $deliveryId)
                ->update(['status' => 'failed', 'last_error' => 'Product missing']);

            return ['status' => 'failed', 'attempts' => $newAttempts, 'error' => 'product_missing'];
        }

        $url  = service('qr_lib')->build_redemption_url((string) $ticket->code);
        $vars = $this->renderVars($product, $ticket, $url);

        try {
            if ($channel === 'email') {
                $subjectTpl = $this->getConfig('ticket_delivery_email_subject', 'Your ticket: {{title}}');
                $subject    = $this->renderTemplate($subjectTpl, $vars);
                $html       = $this->buildEmailHtml($vars, $url);
                $ok         = (new Email_lib())->sendEmail($address, $subject, $html);
                $this->updateExistingAttempt($deliveryId, $ok ? 'sent' : 'failed', $ok ? null : 'Email send returned false');

                return ['status' => $ok ? 'sent' : 'failed', 'attempts' => $newAttempts];
            }
            if ($channel === 'sms') {
                $tpl        = $this->getConfig('ticket_delivery_sms_template', 'Your ticket {{code}} for {{title}} is ready. View: {{url}}');
                $body       = $this->renderTemplate($tpl, $vars);
                $cleanPhone = (int) preg_replace('/[^\d]/', '', $address);
                if ($cleanPhone <= 0) {
                    $this->updateExistingAttempt($deliveryId, 'failed', 'Invalid phone');

                    return ['status' => 'failed', 'attempts' => $newAttempts, 'error' => 'invalid_phone'];
                }
                $ok = (new Sms_lib())->sendSMS($cleanPhone, $body);
                $this->updateExistingAttempt($deliveryId, $ok ? 'sent' : 'failed', $ok ? null : 'SMS gateway returned false');

                return ['status' => $ok ? 'sent' : 'failed', 'attempts' => $newAttempts];
            }

            // Wallet channels are handled out-of-band (passes are downloaded by
            // the customer rather than push-delivered) — bounce so we stop
            // retrying.
            $this->updateExistingAttempt($deliveryId, 'bounced', 'Channel not retriable: ' . $channel);

            return ['status' => 'bounced', 'attempts' => $newAttempts, 'reason' => 'unsupported_channel'];
        } catch (Throwable $e) {
            log_message('error', 'Ticket_delivery_lib::retryRow — ' . $e->getMessage());
            $this->updateExistingAttempt($deliveryId, 'failed', $e->getMessage());

            return ['status' => 'failed', 'attempts' => $newAttempts, 'error' => $e->getMessage()];
        }
    }

    /**
     * Updates status + last_error + sent_at (on success) on an existing
     * ticket_delivery_attempts row WITHOUT touching attempts — that was
     * already bumped by retryRow() above.
     */
    private function updateExistingAttempt(int $deliveryId, string $status, ?string $error): void
    {
        $patch = ['status' => $status, 'last_error' => $error];
        if ($status === 'sent') {
            $patch['sent_at'] = date('Y-m-d H:i:s');
        }
        db_connect()->table('ticket_delivery_attempts')
            ->where('delivery_id', $deliveryId)
            ->update($patch);
    }

    // --- private ---

    private function loadProduct(object $ticket): ?object
    {
        if (isset($ticket->title, $ticket->ticket_product_id)) {
            // Already joined
            return $ticket;
        }
        $db = db_connect();

        return $db->table('ticket_products')
            ->where('ticket_product_id', (int) $ticket->ticket_product_id)
            ->get()
            ->getRow();
    }

    private function channelEnabled(string $channel): bool
    {
        $key = 'ticket_delivery_' . $channel . '_enabled';

        return $this->getConfig($key, '1') === '1';
    }

    private function renderVars(object $product, object $ticket, string $url): array
    {
        return [
            'title'      => (string) ($product->title ?? ''),
            'brand_name' => (string) ($product->brand_name ?? ''),
            'code'       => (string) ($ticket->code ?? ''),
            'url'        => $url,
            'notice'     => (string) ($product->notice ?? ''),
            'valid_from' => (string) ($ticket->valid_from ?? ''),
            'valid_to'   => (string) ($ticket->valid_to ?? ''),
        ];
    }

    private function renderTemplate(string $template, array $vars): string
    {
        return preg_replace_callback(
            '/\{\{\s*(\w+)\s*\}\}/',
            static fn ($m) => (string) ($vars[$m[1]] ?? ''),
            $template,
        );
    }

    private function sendEmail(object $ticket, string $email, object $product, array $vars, string $url): array
    {
        $deliveryId = $this->recordAttempt((int) $ticket->ticket_id, 'email', $email);

        try {
            $subjectTpl = $this->getConfig('ticket_delivery_email_subject', 'Your ticket: {{title}}');
            $subject    = $this->renderTemplate($subjectTpl, $vars);

            $html = $this->buildEmailHtml($vars, $url);

            $email_lib = new Email_lib();
            $ok        = $email_lib->sendEmail($email, $subject, $html);

            $this->markAttempt($deliveryId, $ok ? 'sent' : 'failed', $ok ? null : 'Email send returned false');

            return ['status' => $ok ? 'sent' : 'failed'];
        } catch (Throwable $e) {
            log_message('error', 'Ticket_delivery_lib::sendEmail — ' . $e->getMessage());
            $this->markAttempt($deliveryId, 'failed', $e->getMessage());

            return ['status' => 'failed', 'error' => $e->getMessage()];
        }
    }

    private function sendSms(object $ticket, string $phone, object $product, array $vars): array
    {
        $deliveryId = $this->recordAttempt((int) $ticket->ticket_id, 'sms', $phone);

        try {
            $tpl        = $this->getConfig('ticket_delivery_sms_template', 'Your ticket {{code}} for {{title}} is ready. View: {{url}}');
            $body       = $this->renderTemplate($tpl, $vars);
            $cleanPhone = (int) preg_replace('/[^\d]/', '', $phone);
            if ($cleanPhone <= 0) {
                $this->markAttempt($deliveryId, 'failed', 'Invalid phone');

                return ['status' => 'failed', 'error' => 'Invalid phone'];
            }
            $sms = new Sms_lib();
            $ok  = $sms->sendSMS($cleanPhone, $body);
            $this->markAttempt($deliveryId, $ok ? 'sent' : 'failed', $ok ? null : 'SMS gateway returned false');

            return ['status' => $ok ? 'sent' : 'failed'];
        } catch (Throwable $e) {
            log_message('error', 'Ticket_delivery_lib::sendSms — ' . $e->getMessage());
            $this->markAttempt($deliveryId, 'failed', $e->getMessage());

            return ['status' => 'failed', 'error' => $e->getMessage()];
        }
    }

    private function buildEmailHtml(array $vars, string $url): string
    {
        $title     = esc($vars['title']);
        $brand     = esc($vars['brand_name']);
        $notice    = esc($vars['notice']);
        $code      = esc($vars['code']);
        $validFrom = esc($vars['valid_from']);
        $validTo   = esc($vars['valid_to']);
        $safeUrl   = esc($url);

        return <<<HTML
            <!doctype html>
            <html><body style="font-family:Helvetica,Arial,sans-serif;background:#f7f7fb;padding:20px;">
              <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
                <div style="background:linear-gradient(135deg,#a855f7,#ec4899);padding:24px;color:#fff;">
                  <p style="margin:0;font-size:11px;letter-spacing:1.2px;opacity:0.85;">YOUR TICKET</p>
                  <h1 style="margin:8px 0 4px;font-size:22px;">{$title}</h1>
                  {$brand}
                </div>
                <div style="padding:20px;">
                  <p style="margin:0 0 12px;color:#374151;font-size:14px;">Show this code at the gate:</p>
                  <p style="font-family:monospace;font-size:24px;letter-spacing:2px;background:#f3f4f6;padding:12px;text-align:center;border-radius:8px;color:#111;">{$code}</p>
                  <p style="margin:18px 0 8px;color:#6b7280;font-size:12px;">Valid: {$validFrom} - {$validTo}</p>
                  {$notice}
                  <p style="margin:20px 0 0;text-align:center;">
                    <a href="{$safeUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">View ticket</a>
                  </p>
                </div>
                <div style="padding:12px 20px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:10px;">
                  Signed and verified at the gate. Keep this code private.
                </div>
              </div>
            </body></html>
            HTML;
    }

    private function recordAttempt(int $ticketId, string $channel, string $address): int
    {
        $db = db_connect();
        $db->table('ticket_delivery_attempts')->insert([
            'ticket_id'       => $ticketId,
            'channel'         => $channel,
            'address'         => mb_substr($address, 0, 255),
            'status'          => 'queued',
            'attempts'        => 1,
            'last_attempt_at' => date('Y-m-d H:i:s'),
        ]);

        return (int) $db->insertID();
    }

    private function markAttempt(int $deliveryId, string $status, ?string $error): void
    {
        $patch = [
            'status'          => $status,
            'last_error'      => $error,
            'last_attempt_at' => date('Y-m-d H:i:s'),
        ];
        if ($status === 'sent') {
            $patch['sent_at'] = date('Y-m-d H:i:s');
        }
        db_connect()->table('ticket_delivery_attempts')
            ->where('delivery_id', $deliveryId)
            ->update($patch);
    }

    private function getConfig(string $key, string $default = ''): string
    {
        try {
            $row = db_connect()->table('app_config')->where('key', $key)->get()->getRowArray();

            return $row !== null ? (string) $row['value'] : $default;
        } catch (Throwable $e) {
            return $default;
        }
    }
}
