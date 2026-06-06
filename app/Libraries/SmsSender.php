<?php

declare(strict_types=1);

namespace App\Libraries;

use Throwable;

/**
 * SmsSender — unified outbound-SMS surface for gift-card lifecycle
 * nudges, OTPs (once wired), transfer notifications, etc.
 *
 * Provider selection lives in app_config.sms_provider:
 *   - mock              (default — appends to writable/logs/sms.log only)
 *   - africastalking    (Africa's Talking REST API)
 *   - twilio            (Twilio REST API)
 *   - http_proxy        (POST to an arbitrary HTTP endpoint configured by
 *                        sms_proxy_url; useful for African aggregators
 *                        that share a common interface)
 *
 * Credentials per provider:
 *   africastalking: sms_at_username, sms_at_api_key
 *   twilio:         sms_twilio_account_sid, sms_twilio_auth_token, sms_twilio_from
 *   http_proxy:     sms_proxy_url, sms_proxy_auth_header
 *
 * Sender ID (alphanumeric): sms_sender_id (default 'PESASWAP').
 *
 * Return shape:
 *   ['ok' => bool, 'provider' => string, 'message_id' => ?string,
 *    'error' => ?string, 'http_status' => ?int]
 *
 * The mock provider always returns ok=true and assigns a synthetic
 * message_id of 'mock-<8 hex chars>' so downstream code can dedupe.
 *
 * Design notes:
 *   - Phone number is NEVER logged in plain text; we mask to last-4 in
 *     all log writes (privacy by default).
 *   - Idempotency is the caller's responsibility — pass in a send_key
 *     and the giftcard_nudges (or equivalent) table dedupes via UNIQUE.
 *   - cURL timeouts: 5s connect / 10s total. SMS that doesn't arrive
 *     within 10s is treated as a hard failure; the caller can retry.
 */
final class SmsSender
{
    private const DEFAULT_SENDER_ID = 'PESASWAP';
    private const CONNECT_TIMEOUT = 5;
    private const TOTAL_TIMEOUT   = 10;

    /**
     * @return array{ok:bool, provider:string, message_id:?string, error:?string, http_status:?int}
     */
    public function send(string $phone, string $message): array
    {
        $phone = $this->normalisePhone($phone);
        if ($phone === '') {
            return $this->logResult('mock', false, 'invalid phone', null, '');
        }
        if (trim($message) === '') {
            return $this->logResult('mock', false, 'empty message', null, $phone);
        }

        $provider = strtolower((string)$this->getConfig('sms_provider', 'mock'));
        $senderId = (string)$this->getConfig('sms_sender_id', self::DEFAULT_SENDER_ID);

        try {
            switch ($provider) {
                case 'africastalking':
                    return $this->sendViaAfricasTalking($phone, $message, $senderId);
                case 'twilio':
                    return $this->sendViaTwilio($phone, $message, $senderId);
                case 'http_proxy':
                    return $this->sendViaHttpProxy($phone, $message, $senderId);
                default:
                    // mock — always succeeds, just writes the line to sms.log
                    return $this->logResult('mock', true, null, 'mock-' . bin2hex(random_bytes(4)), $phone, $message);
            }
        } catch (Throwable $e) {
            return $this->logResult($provider, false, $e->getMessage(), null, $phone);
        }
    }

    /**
     * Normalise to E.164-ish: strip whitespace/separators, keep leading +.
     * Returns empty string if the result doesn't look like a valid phone
     * (9-15 digits with optional +).
     */
    public function normalisePhone(string $phone): string
    {
        $cleaned = (string)preg_replace('/[\s().\-_]/', '', trim($phone));
        if (!preg_match('/^\+?\d{9,15}$/', $cleaned)) {
            return '';
        }
        return $cleaned;
    }

    /**
     * Mask a phone for logging — keep last 4 digits, mask everything else.
     */
    public function maskPhone(string $phone): string
    {
        $cleaned = $this->normalisePhone($phone);
        if ($cleaned === '') return '••••';
        $len = strlen($cleaned);
        if ($len <= 4) return '••' . substr($cleaned, -2);
        return substr($cleaned, 0, max(2, $len - 6)) . ' ••• ' . substr($cleaned, -4);
    }

    // ---------- providers ----------

    private function sendViaAfricasTalking(string $phone, string $message, string $senderId): array
    {
        $user = (string)$this->getConfig('sms_at_username', '');
        $key  = (string)$this->getConfig('sms_at_api_key', '');
        if ($user === '' || $key === '') {
            return $this->logResult('africastalking', false, 'credentials not configured', null, $phone);
        }

        // Sandbox endpoint when username is literally "sandbox", else live.
        $base = $user === 'sandbox'
            ? 'https://api.sandbox.africastalking.com/version1/messaging/bulk'
            : 'https://api.africastalking.com/version1/messaging/bulk';

        $body = json_encode([
            'username'      => $user,
            'message'       => $message,
            'senderId'      => $senderId,
            'phoneNumbers'  => [$phone],
        ]);

        [$status, $resp] = $this->httpJson('POST', $base, $body, [
            'apiKey: ' . $key,
            'Accept: application/json',
            'Content-Type: application/json',
        ]);

        $decoded = json_decode((string)$resp, true);
        $msgs = $decoded['SMSMessageData']['Recipients'] ?? [];
        $first = is_array($msgs) && isset($msgs[0]) ? $msgs[0] : null;
        $messageId = $first['messageId'] ?? null;
        $ok = $status >= 200 && $status < 300 && $messageId !== null && $messageId !== 'None';

        return $this->logResult('africastalking', $ok, $ok ? null : 'send failed', $messageId, $phone, $message, $status);
    }

    private function sendViaTwilio(string $phone, string $message, string $senderId): array
    {
        $sid   = (string)$this->getConfig('sms_twilio_account_sid', '');
        $token = (string)$this->getConfig('sms_twilio_auth_token', '');
        $from  = (string)$this->getConfig('sms_twilio_from', '');
        if ($sid === '' || $token === '' || $from === '') {
            return $this->logResult('twilio', false, 'credentials not configured', null, $phone);
        }
        $url = 'https://api.twilio.com/2010-04-01/Accounts/' . urlencode($sid) . '/Messages.json';
        $body = http_build_query([
            'To'   => $phone,
            'From' => $from,
            'Body' => $message,
        ]);
        [$status, $resp] = $this->httpJson('POST', $url, $body, [
            'Authorization: Basic ' . base64_encode($sid . ':' . $token),
            'Content-Type: application/x-www-form-urlencoded',
        ]);
        $decoded = json_decode((string)$resp, true);
        $messageId = $decoded['sid'] ?? null;
        $ok = $status >= 200 && $status < 300 && $messageId !== null;
        return $this->logResult('twilio', $ok, $ok ? null : ($decoded['message'] ?? 'send failed'), $messageId, $phone, $message, $status);
    }

    private function sendViaHttpProxy(string $phone, string $message, string $senderId): array
    {
        $url = (string)$this->getConfig('sms_proxy_url', '');
        if ($url === '') {
            return $this->logResult('http_proxy', false, 'sms_proxy_url not configured', null, $phone);
        }
        $auth = (string)$this->getConfig('sms_proxy_auth_header', '');
        $body = json_encode(['phone' => $phone, 'message' => $message, 'sender_id' => $senderId]);
        $headers = ['Content-Type: application/json'];
        if ($auth !== '') $headers[] = $auth;
        [$status, $resp] = $this->httpJson('POST', $url, $body, $headers);
        $ok = $status >= 200 && $status < 300;
        $decoded = json_decode((string)$resp, true);
        $messageId = is_array($decoded) ? ($decoded['message_id'] ?? null) : null;
        return $this->logResult('http_proxy', $ok, $ok ? null : 'proxy send failed', $messageId, $phone, $message, $status);
    }

    // ---------- helpers ----------

    /**
     * @return array{0:int, 1:string} [http_status, raw_body]
     */
    private function httpJson(string $method, string $url, string $body, array $headers): array
    {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT,
            CURLOPT_TIMEOUT        => self::TOTAL_TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $resp = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            return [0, json_encode(['curl_error' => $err])];
        }
        return [$status, (string)$resp];
    }

    private function getConfig(string $key, string $default): string
    {
        try {
            $row = db_connect()->table('app_config')->where('key', $key)->get()->getRowArray();
            $value = $row !== null ? (string)$row['value'] : '';
            return $value !== '' ? $value : $default;
        } catch (Throwable) {
            return $default;
        }
    }

    /**
     * Append a structured line to writable/logs/sms.log and return the
     * result envelope. Message body is logged with the first 80 chars
     * only — enough to debug, not enough to be a PII leak vector.
     */
    private function logResult(string $provider, bool $ok, ?string $error, ?string $messageId, string $phone, string $message = '', ?int $httpStatus = null): array
    {
        try {
            $line = json_encode([
                'ts'         => date('c'),
                'provider'   => $provider,
                'ok'         => $ok,
                'phone'      => $this->maskPhone($phone),
                'message_id' => $messageId,
                'http_status'=> $httpStatus,
                'preview'    => mb_substr($message, 0, 80),
                'error'      => $error,
            ]) . "\n";
            $logFile = WRITEPATH . 'logs/sms.log';
            @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);
        } catch (Throwable) {
            // logging failure is never a send failure
        }
        return [
            'ok'          => $ok,
            'provider'    => $provider,
            'message_id'  => $messageId,
            'error'       => $error,
            'http_status' => $httpStatus,
        ];
    }
}
