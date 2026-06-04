<?php
/**
 * Public ticket claim/verify page.
 *
 * Rendered at /t/{token}. Never reveals signed tokens for any other ticket
 * and never performs redemption.
 *
 * @var ?object $ticket
 * @var ?string $qr_svg
 * @var ?string $error
 */
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= esc($ticket->product_title ?? 'Ticket') ?></title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f6f8; margin: 0; padding: 20px; color: #1f2328; }
        .card { max-width: 420px; margin: 40px auto; background: #fff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.08); overflow: hidden; }
        .card-header { padding: 20px 24px; color: #fff; background: #1f6feb; }
        .card-header h1 { margin: 0; font-size: 20px; }
        .card-header .brand { font-size: 12px; opacity: 0.85; margin-top: 4px; }
        .qr { padding: 24px; text-align: center; background: #fff; }
        .qr svg { width: 240px; height: 240px; }
        .meta { padding: 0 24px 20px; }
        .meta dt { font-size: 11px; text-transform: uppercase; color: #57606a; letter-spacing: 0.04em; margin-top: 12px; }
        .meta dd { margin: 4px 0 0; font-size: 14px; font-weight: 500; }
        .notice { padding: 14px 24px; background: #fff8c5; border-top: 1px solid #f0d000; font-size: 13px; }
        .error { padding: 40px 24px; text-align: center; color: #cf222e; }
        .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; }
        .status-issued, .status-active { background: #ddf4ff; color: #0969da; }
        .status-redeemed { background: #eef2f5; color: #57606a; }
        .status-revoked, .status-expired, .status-refunded { background: #ffebe9; color: #cf222e; }
        .footer { padding: 14px 24px; font-size: 11px; color: #57606a; text-align: center; }
    </style>
</head>
<body>
<div class="card">
    <?php if ($error !== null || !isset($ticket)): ?>
        <div class="error">
            <h2>Ticket unavailable</h2>
            <p>This ticket link is invalid, expired or has been revoked.</p>
        </div>
    <?php else: ?>
        <div class="card-header" style="background: <?= esc($ticket->color ?: '#1f6feb') ?>">
            <h1><?= esc($ticket->product_title ?? 'Ticket') ?></h1>
            <div class="brand"><?= esc($ticket->brand_name ?? '') ?></div>
        </div>

        <div class="qr">
            <?= $qr_svg ?? '' ?>
            <div style="margin-top: 12px; font-family: monospace; font-size: 13px; letter-spacing: 2px;">
                <?= esc($ticket->code) ?>
            </div>
        </div>

        <dl class="meta">
            <dt>Status</dt>
            <dd><span class="status status-<?= esc($ticket->status) ?>"><?= esc($ticket->status) ?></span></dd>

            <?php if (!empty($ticket->valid_from)): ?>
                <dt>Valid From</dt><dd><?= esc($ticket->valid_from) ?></dd>
            <?php endif; ?>
            <?php if (!empty($ticket->valid_to)): ?>
                <dt>Valid To</dt><dd><?= esc($ticket->valid_to) ?></dd>
            <?php endif; ?>

            <?php if (!empty($ticket->seat_assignment_json)): ?>
                <dt>Seat</dt>
                <dd><?= esc($ticket->seat_assignment_json) ?></dd>
            <?php endif; ?>

            <?php if (!empty($ticket->description)): ?>
                <dt>Details</dt>
                <dd><?= nl2br(esc($ticket->description)) ?></dd>
            <?php endif; ?>
        </dl>

        <?php if (!empty($ticket->notice)): ?>
            <div class="notice"><?= esc($ticket->notice) ?></div>
        <?php endif; ?>

        <div class="footer">
            <?php if (!empty($ticket->service_phone)): ?>Customer service: <?= esc($ticket->service_phone) ?><?php endif; ?>
        </div>
    <?php endif; ?>
</div>
</body>
</html>
