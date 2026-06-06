<?php

namespace App\Libraries;

use RuntimeException;
use Throwable;

/**
 * PII encryption-at-rest helper using AES-256-GCM with envelope encoding.
 *
 * Wire format (base64 of a fixed structure):
 *
 *   v01.{iv_b64}.{ciphertext_b64}.{tag_b64}
 *
 * Where:
 *   - v01           — algorithm + version marker (lets us rotate to v02 later)
 *   - iv_b64        — 12 random bytes (GCM standard)
 *   - ciphertext_b64
 *   - tag_b64       — 16-byte authentication tag (GCM integrity proof)
 *
 * The master key comes from \\App\\Libraries\\Secrets_vault under logical key
 * 'pii_master_key' (32 bytes hex = 64 chars, or 32 raw bytes). Same vault
 * resolution rules apply: env var > _FILE secret mount > app_config row.
 *
 * Usage:
 *   $crypto = service('pii_crypto');
 *   $enc = $crypto->encrypt('john@example.com');
 *   $dec = $crypto->decrypt($enc);  // → 'john@example.com'
 *
 * For columns that need to be QUERIED (e.g. "find a customer by email")
 * keep a deterministic SHA256 HMAC sidecar column alongside the encrypted
 * blob — same pattern Phase 2 ticket_transfers already uses for
 * to_contact_hash. Don't try to make AES-GCM searchable.
 *
 * Why GCM not CBC?
 *   GCM provides authenticated encryption (tamper detection) in one step,
 *   no separate HMAC needed. PHP openssl_encrypt has supported it since
 *   PHP 7.1 so it's universally available.
 *
 * Why not libsodium / crypto_secretbox?
 *   Cleaner API but adds a hard ext-sodium dependency that some PHP
 *   builds don't ship by default (esp. old shared hosts). openssl is
 *   always present.
 */
class Pii_crypto
{
    private const VERSION_TAG = 'v01';
    private const CIPHER      = 'aes-256-gcm';
    private const IV_BYTES    = 12;   // GCM standard
    private const TAG_BYTES   = 16;
    private const KEY_BYTES   = 32;   // 256 bits

    private ?string $cachedKey = null;

    /**
     * Encrypts a UTF-8 string. Returns the wire-format string or null
     * for null input (so callers can store NULL through the helper
     * without a separate guard).
     *
     * Throws RuntimeException if the master key is unavailable or
     * malformed — encrypting without a key would silently emit
     * recoverable plaintext, which is worse than a hard failure.
     */
    public function encrypt(?string $plaintext): ?string
    {
        if ($plaintext === null) {
            return null;
        }
        $key = $this->loadKey();
        $iv  = random_bytes(self::IV_BYTES);
        $tag = '';
        $ct  = openssl_encrypt(
            $plaintext,
            self::CIPHER,
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_BYTES,
        );
        if ($ct === false) {
            throw new RuntimeException('openssl_encrypt failed: ' . (openssl_error_string() ?: 'unknown'));
        }

        return implode('.', [
            self::VERSION_TAG,
            $this->b64u($iv),
            $this->b64u($ct),
            $this->b64u($tag),
        ]);
    }

    /**
     * Decrypts a wire-format string. Returns null for null input or
     * (deliberately) when the input is malformed — callers can treat
     * "couldn't decrypt" as "no PII" without exception flow.
     *
     * Throws RuntimeException only when the key is unavailable — that
     * indicates a deployment misconfiguration that needs operator
     * attention, not a row-level data issue.
     */
    public function decrypt(?string $envelope): ?string
    {
        if ($envelope === null || $envelope === '') {
            return null;
        }
        $key = $this->loadKey();

        $parts = explode('.', $envelope);
        if (count($parts) !== 4 || $parts[0] !== self::VERSION_TAG) {
            return null;
        }
        try {
            $iv  = $this->b64uDecode($parts[1]);
            $ct  = $this->b64uDecode($parts[2]);
            $tag = $this->b64uDecode($parts[3]);
            if (strlen($iv) !== self::IV_BYTES || strlen($tag) !== self::TAG_BYTES) {
                return null;
            }
            $pt = openssl_decrypt(
                $ct,
                self::CIPHER,
                $key,
                OPENSSL_RAW_DATA,
                $iv,
                $tag,
                '',
            );

            return $pt === false ? null : $pt;
        } catch (Throwable $e) {
            return null;
        }
    }

    /**
     * Returns true when the master key is resolvable + the right size.
     * Useful in health checks and migration guards — never logs the key.
     */
    public function isConfigured(): bool
    {
        try {
            $this->loadKey();

            return true;
        } catch (Throwable $e) {
            return false;
        }
    }

    /**
     * Deterministic HMAC-SHA256 of $value using the master key.
     * Use this for "find a row by encrypted column" — store the HMAC
     * alongside the ciphertext in a separate `*_hash` column, and
     * query by the HMAC value.
     *
     * The HMAC is keyed (not a plain SHA256) so a database leak alone
     * doesn't allow an attacker to test whether a known email is in
     * the dataset (rainbow-table resistance).
     */
    public function hashLookup(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return hash_hmac('sha256', $value, $this->loadKey());
    }

    /**
     * Resolves and caches the master key. Accepts:
     *   - 64-char hex (32 bytes encoded as hex)
     *   - 32 raw bytes
     *   - 44-char base64 (standard, with or without trailing =)
     */
    private function loadKey(): string
    {
        if ($this->cachedKey !== null) {
            return $this->cachedKey;
        }
        $raw = service('secrets_vault')->get('pii_master_key');
        if ($raw === '') {
            throw new RuntimeException(
                "PII master key not configured. Set 'pii_master_key' via env "
                . 'PII_MASTER_KEY (or _FILE), or insert into app_config. '
                . 'Generate with: openssl rand -hex 32',
            );
        }

        $key = $this->normaliseKey(trim($raw));
        if (strlen($key) !== self::KEY_BYTES) {
            throw new RuntimeException(sprintf(
                'PII master key has wrong length: expected %d raw bytes, got %d.',
                self::KEY_BYTES,
                strlen($key),
            ));
        }
        $this->cachedKey = $key;

        return $key;
    }

    /**
     * Accepts hex / base64 / raw bytes and returns 32 raw bytes.
     */
    private function normaliseKey(string $raw): string
    {
        if (strlen($raw) === self::KEY_BYTES * 2 && ctype_xdigit($raw)) {
            return hex2bin($raw);
        }
        if (strlen($raw) === self::KEY_BYTES) {
            return $raw;
        }
        $decoded = base64_decode($raw, true);
        if ($decoded !== false && strlen($decoded) === self::KEY_BYTES) {
            return $decoded;
        }

        // Last-ditch: hash arbitrary input to 32 bytes so a misformatted
        // dev key doesn't break the dev loop — but log a warning so
        // production deployments notice.
        log_message('warning', 'Pii_crypto::loadKey - master key not 32 bytes; deriving via SHA256.');

        return hash('sha256', $raw, true);
    }

    /**
     * Base64-url encoding (RFC 4648 §5) — same scheme JWT uses.
     * No padding, +/ replaced with -_, safe for URLs and headers.
     */
    private function b64u(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    private function b64uDecode(string $s): string
    {
        $padding = strlen($s) % 4;
        if ($padding > 0) {
            $s .= str_repeat('=', 4 - $padding);
        }
        $decoded = base64_decode(strtr($s, '-_', '+/'), true);

        return $decoded === false ? '' : $decoded;
    }

    /** For tests — drop the cached key so a new vault config takes effect. */
    public function flush(): void
    {
        $this->cachedKey = null;
    }
}
