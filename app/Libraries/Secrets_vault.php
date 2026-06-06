<?php

namespace App\Libraries;

/**
 * Secrets Vault — resolves a logical credential name to its value via
 * a three-tier fallthrough:
 *
 *   1. Environment variable (UPPERCASE_SNAKE)
 *      e.g. logical 'ticket_apple_pass_key_pem' → env TICKET_APPLE_PASS_KEY_PEM
 *
 *   2. *_FILE env var pointing at a readable file (Docker / Kubernetes
 *      / systemd secrets convention)
 *      e.g. env TICKET_APPLE_PASS_KEY_PEM_FILE=/run/secrets/apple_key.pem
 *           → returns file_get_contents() of that path
 *
 *   3. app_config[key] (legacy plaintext storage)
 *
 * Returns '' if no tier resolves. The order is deliberate: env beats
 * mounted file beats DB, so a deployment can override DB config without
 * a code change or DB migration.
 *
 * Why not just read env directly everywhere?
 *   - keeps callsites consistent (one helper, one cache)
 *   - centralises the *_FILE pattern (Docker swarm/k8s secret convention)
 *   - preserves backward-compat with the existing app_config rows
 *   - gives a single chokepoint for adding HashiCorp Vault / AWS SSM
 *     adapters later without touching 30 callsites
 *
 * Usage:
 *   $key = service('secrets_vault')->get('ticket_apple_pass_key_pem');
 *   if ($key === '') { throw ... }
 *
 * Wired as a CI4 shared service in app/Config/Services.php so callers
 * get the per-request cache automatically.
 */
class Secrets_vault
{
    /**
     * Per-request cache so repeated reads (e.g. building 50 passes in a
     * batch) don't hit the DB / env / disk 50 times.
     *
     * @var array<string, string>
     */
    private array $cache = [];

    public function get(string $logicalKey): string
    {
        if (array_key_exists($logicalKey, $this->cache)) {
            return $this->cache[$logicalKey];
        }

        $value = $this->resolve($logicalKey);
        $this->cache[$logicalKey] = $value;

        return $value;
    }

    /**
     * Reset the per-request cache. Useful in tests and after a credential
     * rotation so the next read picks up the new value.
     */
    public function flush(): void
    {
        $this->cache = [];
    }

    /**
     * Returns the source that resolved the key — useful for an admin
     * "what's loaded where" diagnostic page. Never returns the value.
     *
     * @return 'env'|'file'|'db'|'missing'
     */
    public function source(string $logicalKey): string
    {
        $envName = $this->envName($logicalKey);
        if (($v = getenv($envName)) !== false && $v !== '') {
            return 'env';
        }
        $fileVar = $envName . '_FILE';
        $path    = getenv($fileVar);
        if ($path !== false && $path !== '' && is_readable($path)) {
            return 'file';
        }
        if ($this->readAppConfig($logicalKey) !== '') {
            return 'db';
        }

        return 'missing';
    }

    private function resolve(string $logicalKey): string
    {
        $envName = $this->envName($logicalKey);

        // 1. Direct env var
        $direct = getenv($envName);
        if ($direct !== false && $direct !== '') {
            return $direct;
        }

        // 2. *_FILE — mount-style secret (docker secret, k8s projected
        //    secret, systemd LoadCredential). Read the file contents.
        $filePath = getenv($envName . '_FILE');
        if ($filePath !== false && $filePath !== '' && is_readable($filePath)) {
            $contents = @file_get_contents($filePath);
            if ($contents !== false && $contents !== '') {
                // Trim trailing newline that text editors love to add to
                // secret files; PEM/JSON readers don't care, but
                // string-equality checks (e.g. passwords) would.
                return rtrim($contents, "\r\n");
            }
        }

        // 3. Legacy app_config fallback
        return $this->readAppConfig($logicalKey);
    }

    private function readAppConfig(string $logicalKey): string
    {
        try {
            $db = \Config\Database::connect();
            if (! $db->tableExists('app_config')) {
                return '';
            }
            $row = $db->table('app_config')
                ->select('value')
                ->where('key', $logicalKey)
                ->get()
                ->getRowArray();

            return $row !== null ? (string) $row['value'] : '';
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function envName(string $logicalKey): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9_]/', '_', $logicalKey) ?? $logicalKey);
    }
}
