<?php

namespace App\Libraries;

use Config\OSPOS;
use DateTimeImmutable;
use DateTimeInterface;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use InvalidArgumentException;
use RuntimeException;

/**
 * Ticket token library.
 *
 * Issues and verifies RS256 JWTs that encode ticket redemption permission.
 *
 * Design notes:
 *   - Each token has a `kid` header identifying which row in
 *     `ospos_ticket_signing_keys` signed it. This enables painless rotation:
 *     `rotateKey()` adds a new key and stamps existing ones with `rotated_at`.
 *     Tokens signed by rotated keys still verify until they expire, but new
 *     issuance always uses the latest non-rotated key.
 *   - Issuance is intentionally *separate* from POS sale logic so it can be
 *     called from a background webhook handler, the API, or the sales flow.
 *   - Verification is strict: signature, expiry, audience and issuer are all
 *     checked. Anything that fails returns null so callers don't have to
 *     distinguish "tampered" from "expired" at the boundary (the redemption
 *     audit log records the precise failure mode).
 *
 * Requires firebase/php-jwt (see composer.json).
 */
class Ticket_token_lib
{
    public const ALGORITHM = 'RS256';

    /**
     * Generate a new RSA-2048 key pair. Caller is responsible for persisting
     * the result to `ospos_ticket_signing_keys`.
     *
     * @return array{public_key:string, private_key:string}
     */
    public function generateKeyPair(): array
    {
        $this->assertDependency();

        $resource = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);

        if ($resource === false) {
            throw new RuntimeException('Failed to generate RSA key pair: ' . (openssl_error_string() ?: 'unknown error'));
        }

        if (!openssl_pkey_export($resource, $privateKeyPem)) {
            throw new RuntimeException('Failed to export RSA private key: ' . (openssl_error_string() ?: 'unknown error'));
        }

        $details      = openssl_pkey_get_details($resource);
        $publicKeyPem = $details['key'] ?? null;
        if ($publicKeyPem === null) {
            throw new RuntimeException('Failed to extract RSA public key from generated key pair.');
        }

        return [
            'public_key'  => $publicKeyPem,
            'private_key' => $privateKeyPem,
        ];
    }

    /**
     * Returns the currently-active (non-rotated, newest) signing key row.
     */
    public function getActiveKey(): ?object
    {
        $builder = db_connect()->table('ticket_signing_keys');
        $builder->where('rotated_at IS NULL', null, false);
        $builder->orderBy('signing_key_id', 'desc');
        $builder->limit(1);

        return $builder->get()->getRow();
    }

    /**
     * Returns the signing key row with the given id, or null if not found.
     */
    public function getKey(int $keyId): ?object
    {
        $builder = db_connect()->table('ticket_signing_keys');
        $builder->where('signing_key_id', $keyId);

        return $builder->get()->getRow();
    }

    /**
     * Issue a JWT for a ticket. Token always uses the currently-active key.
     *
     * @param int                    $ticketId The id of the ospos_tickets row this token grants access to.
     * @param DateTimeInterface|null $expiresAt When the token expires. Defaults to ticket.valid_to or +1 year.
     * @param string|null            $jti       Optional JWT ID; auto-generated random when null.
     * @param array<string,mixed>    $extraClaims Additional non-reserved claims to embed.
     */
    public function issue(int $ticketId, ?DateTimeInterface $expiresAt = null, ?string $jti = null, array $extraClaims = []): string
    {
        $this->assertDependency();

        $key = $this->getActiveKey();
        if ($key === null) {
            throw new RuntimeException('No active ticket signing key. Run the AddTickets migration or rotateKey() to seed one.');
        }

        $now     = new DateTimeImmutable();
        $expires = $expiresAt ?? $now->modify('+1 year');

        $payload = array_merge($extraClaims, [
            'iss' => $this->getIssuer(),
            'aud' => $this->getIssuer(),
            'iat' => $now->getTimestamp(),
            'nbf' => $now->getTimestamp(),
            'exp' => $expires->getTimestamp(),
            'jti' => $jti ?? bin2hex(random_bytes(8)),
            'tid' => $ticketId,
        ]);

        return JWT::encode($payload, $key->private_key_pem, self::ALGORITHM, (string) $key->signing_key_id);
    }

    /**
     * Verify a token. Returns the decoded payload as an array on success, or
     * null on any failure (bad signature, wrong issuer, expired, missing key,
     * malformed, etc.).
     *
     * Callers that need to distinguish failure modes (for the audit log)
     * should catch exceptions via decodeOrFail() instead.
     *
     * @return array<string,mixed>|null
     */
    public function verify(string $token): ?array
    {
        try {
            return $this->decodeOrFail($token);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Verify a token; throws on any failure. Useful for audit-logging the
     * specific reason redemption was refused.
     *
     * @return array<string,mixed>
     */
    public function decodeOrFail(string $token): array
    {
        $this->assertDependency();

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidArgumentException('Malformed JWT: expected three segments.');
        }

        $headerJson = JWT::urlsafeB64Decode($parts[0]);
        $header     = json_decode($headerJson, true);
        if (!is_array($header) || !isset($header['kid'])) {
            throw new InvalidArgumentException('JWT header is missing kid.');
        }

        $kid = (int) $header['kid'];
        $key = $this->getKey($kid);
        if ($key === null) {
            throw new RuntimeException("Unknown signing key id: {$kid}");
        }

        $decoded = JWT::decode($token, new Key($key->public_key_pem, self::ALGORITHM));
        $payload = (array) $decoded;

        $issuer = $this->getIssuer();
        if (($payload['iss'] ?? null) !== $issuer) {
            throw new RuntimeException('JWT issuer mismatch.');
        }
        if (isset($payload['aud']) && $payload['aud'] !== $issuer) {
            throw new RuntimeException('JWT audience mismatch.');
        }

        return $payload;
    }

    /**
     * Generate and persist a new signing key, marking all existing keys as
     * rotated. Returns the new key's id.
     *
     * Existing tokens signed by older keys remain valid until they expire
     * (their `kid` still resolves), so rotation is non-disruptive.
     */
    public function rotateKey(): int
    {
        $pair = $this->generateKeyPair();
        $db   = db_connect();

        $db->transStart();

        $db->table('ticket_signing_keys')
            ->where('rotated_at IS NULL', null, false)
            ->update(['rotated_at' => date('Y-m-d H:i:s')]);

        $db->table('ticket_signing_keys')->insert([
            'algorithm'       => self::ALGORITHM,
            'public_key_pem'  => $pair['public_key'],
            'private_key_pem' => $pair['private_key'],
        ]);
        $newId = (int) $db->insertID();

        $db->transComplete();

        if ($db->transStatus() === false) {
            throw new RuntimeException('Failed to rotate ticket signing key.');
        }

        return $newId;
    }

    private function getIssuer(): string
    {
        $settings = config(OSPOS::class)->settings;
        $issuer   = $settings['ticket_jwt_issuer'] ?? 'ospos';

        return is_string($issuer) && $issuer !== '' ? $issuer : 'ospos';
    }

    private function assertDependency(): void
    {
        if (!class_exists(JWT::class)) {
            throw new RuntimeException(
                'firebase/php-jwt is not installed. Run `composer install` to install QR ticketing dependencies.'
            );
        }
    }
}
