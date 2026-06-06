<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Adds the security headers that CI4's bundled SecureHeaders filter
 * doesn't ship by default: Content-Security-Policy, Strict-Transport-Security,
 * Permissions-Policy, Cross-Origin-Opener-Policy, and Cross-Origin-Resource-Policy.
 *
 * Registered in App\Config\Filters as 'enhancedheaders' and added to the
 * 'after' globals list alongside the existing 'secureheaders' filter, so
 * the two work additively (CI4 SecureHeaders provides X-Frame-Options,
 * X-Content-Type-Options, etc; this filter adds the modern headers).
 *
 * CSP defaults to Report-Only mode so a misconfigured rule doesn't break
 * the SPA on first deploy. To enforce, set app_config['security.csp.mode']
 * to 'enforce' and re-deploy.
 */
class EnhancedSecureHeaders implements FilterInterface
{
    /**
     * Conservative CSP suitable for the React/Vite SPA + public claim pages.
     * - 'self' for scripts/styles/connects
     * - 'unsafe-inline' kept on style-src because Tailwind utility classes
     *   inject scoped <style> blocks during dev/SSR
     * - 'unsafe-eval' deliberately NOT allowed
     * - img-src includes data: + blob: so generated QR codes render
     * - connect-src includes Google Wallet endpoints for Save-to-Wallet flow
     * - frame-ancestors 'self' replaces the legacy X-Frame-Options behavior
     */
    private const DEFAULT_CSP_DIRECTIVES = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' https://walletobjects.googleapis.com",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
    ];

    /**
     * @param list<string>|null $arguments
     */
    public function before(RequestInterface $request, $arguments = null)
    {
        return null;
    }

    /**
     * @param list<string>|null $arguments
     */
    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // Skip on API responses — they're JSON, not HTML, so CSP wouldn't apply
        // and the headers needlessly inflate every API response. Adjust this
        // check if the API ever serves HTML (e.g. webhooks UI).
        $uri = (string) $request->getUri();
        $isApi = str_contains($uri, '/api/') || str_contains($uri, '/index.php/api/');

        if (! $isApi) {
            $cspMode = $this->getCspMode();
            $csp     = implode('; ', self::DEFAULT_CSP_DIRECTIVES);
            $header  = $cspMode === 'enforce'
                ? 'Content-Security-Policy'
                : 'Content-Security-Policy-Report-Only';
            $response->setHeader($header, $csp);
        }

        // HSTS: only emit on HTTPS responses (PHP's $_SERVER['HTTPS'] check via
        // request->isSecure). Browsers ignore HSTS over plain HTTP anyway, and
        // emitting it from dev http://localhost would set the policy for the
        // domain at-large which is a footgun.
        if ($request->isSecure()) {
            $response->setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        // Permissions-Policy — disable browser features the SPA doesn't use.
        // The scanner page DOES need camera access, but that's served from the
        // /checkin subpath; for everything else we lock the API surface down.
        $response->setHeader(
            'Permissions-Policy',
            'accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
        );

        // Cross-origin isolation — recommended by OWASP for modern apps even
        // if no SharedArrayBuffer / cross-origin embedded content is used.
        $response->setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        $response->setHeader('Cross-Origin-Resource-Policy', 'same-site');

        return $response;
    }

    /**
     * Returns 'enforce' or 'report-only' based on app_config. Falls back to
     * 'report-only' if the table doesn't exist (e.g. fresh install pre-migration).
     */
    private function getCspMode(): string
    {
        try {
            $db = \Config\Database::connect();
            if (! $db->tableExists('app_config')) {
                return 'report-only';
            }
            $row = $db->table('app_config')
                ->select('value')
                ->where('key', 'security.csp.mode')
                ->get()
                ->getRow();

            return ($row && $row->value === 'enforce') ? 'enforce' : 'report-only';
        } catch (\Throwable $e) {
            return 'report-only';
        }
    }
}
