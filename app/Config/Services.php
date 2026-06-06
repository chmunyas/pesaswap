<?php

namespace Config;

use App\Libraries\Apple_pkpass_lib;
use App\Libraries\Google_wallet_lib;
use App\Libraries\MY_Language;
use App\Libraries\Qr_lib;
use App\Libraries\Pii_crypto;
use App\Libraries\Secrets_vault;
use App\Libraries\Ticket_delivery_lib;
use App\Libraries\Ticket_issuer;
use App\Libraries\Ticket_token_lib;
use App\Libraries\Webhook_dispatcher;
use CodeIgniter\Config\BaseService;
use CodeIgniter\HTTP\IncomingRequest;
use Config\Services as AppServices;
use HTMLPurifier;
use HTMLPurifier_Config;
use Locale;

/**
 * Services Configuration file.
 *
 * Services are simply other classes/libraries that the system uses
 * to do its job. This is used by CodeIgniter to allow the core of the
 * framework to be swapped out easily without affecting the usage within
 * the rest of your application.
 *
 * This file holds any application-specific services, or service overrides
 * that you might need. An example has been included with the general
 * method format you should use for your service methods. For more examples,
 * see the core Services file at system/Config/Services.php.
 */
class Services extends BaseService
{
    private static HTMLPurifier $htmlPurifier;
    /*
     * public static function example($getShared = true)
     * {
     *     if ($getShared) {
     *         return static::getSharedInstance('example');
     *     }
     *
     *     return new \CodeIgniter\Example();
     * }
     */

    /**
     * Responsible for loading the language string translations.
     */
    public static function language(?string $locale = null, bool $getShared = true): MY_Language
    {
        if ($getShared) {
            return static::getSharedInstance('language', $locale)->setLocale($locale);
        }

        if (AppServices::get('request') instanceof IncomingRequest) {
            $requestLocale = AppServices::get('request')->getLocale();
        } else {
            $requestLocale = Locale::getDefault();
        }

        // Use '?:' for empty string check
        $locale = $locale ?: $requestLocale;

        return new MY_Language($locale);
    }

    public static function htmlPurifier($getShared = true): object
    {
        if ($getShared) {
            return static::getSharedInstance('htmlPurifier');
        }

        if (! isset(static::$htmlPurifier)) {
            $config               = HTMLPurifier_Config::createDefault();
            static::$htmlPurifier = new HTMLPurifier($config);
        }

        return static::$htmlPurifier;
    }

    /**
     * Wrapper around chillerlan/php-qrcode used by ticket rendering.
     */
    public static function qr_lib(bool $getShared = true): Qr_lib
    {
        if ($getShared) {
            return static::getSharedInstance('qr_lib');
        }

        return new Qr_lib();
    }

    /**
     * RS256 JWT issuer/verifier for ticket redemption tokens.
     */
    public static function ticket_token_lib(bool $getShared = true): Ticket_token_lib
    {
        if ($getShared) {
            return static::getSharedInstance('ticket_token_lib');
        }

        return new Ticket_token_lib();
    }

    /**
     * Issues tickets from completed sales lines. Used by the Sale model
     * after a successful COMPLETED transaction.
     */
    public static function ticket_issuer(bool $getShared = true): Ticket_issuer
    {
        if ($getShared) {
            return static::getSharedInstance('ticket_issuer');
        }

        return new Ticket_issuer();
    }

    /**
     * Phase 3: fan-out delivery (email + SMS + wallet) for newly issued
     * tickets. Hooked into Ticket_issuer post-issue + manual issuance.
     */
    public static function ticket_delivery_lib(bool $getShared = true): Ticket_delivery_lib
    {
        if ($getShared) {
            return static::getSharedInstance('ticket_delivery_lib');
        }

        return new Ticket_delivery_lib();
    }

    /**
     * Phase 3: builds Google Wallet save-to-wallet JWTs.
     */
    public static function google_wallet_lib(bool $getShared = true): Google_wallet_lib
    {
        if ($getShared) {
            return static::getSharedInstance('google_wallet_lib');
        }

        return new Google_wallet_lib();
    }

    /**
     * Resolves logical secret names to values via env > *_FILE > app_config
     * fallthrough. Centralises wallet credentials, signing keys, MNO API
     * secrets so they can be sourced from Docker/k8s secret mounts rather
     * than plaintext app_config rows (ent-secrets-vault).
     */
    public static function secrets_vault(bool $getShared = true): Secrets_vault
    {
        if ($getShared) {
            return static::getSharedInstance('secrets_vault');
        }

        return new Secrets_vault();
    }

    /**
     * Webhook fan-out for ticket lifecycle events. publish() enqueues,
     * dispatchPending() (called from spark tickets:dispatch-webhooks)
     * does the actual HTTP POST + exponential-backoff retry.
     */
    public static function webhook_dispatcher(bool $getShared = true): Webhook_dispatcher
    {
        if ($getShared) {
            return static::getSharedInstance('webhook_dispatcher');
        }

        return new Webhook_dispatcher();
    }

    /**
     * AES-256-GCM encryption helper for PII columns (email/phone/etc).
     * Wire format: v01.iv.ciphertext.tag (base64url). Master key from
     * Secrets_vault under 'pii_master_key'. Pairs with hashLookup() for
     * deterministic-HMAC sidecar columns when query-by-value is needed
     * (ent-pii-encryption-rest).
     */
    public static function pii_crypto(bool $getShared = true): Pii_crypto
    {
        if ($getShared) {
            return static::getSharedInstance('pii_crypto');
        }

        return new Pii_crypto();
    }

    /**
     * Phase 3: builds signed Apple Wallet .pkpass bundles.
     */
    public static function apple_pkpass_lib(bool $getShared = true): Apple_pkpass_lib
    {
        if ($getShared) {
            return static::getSharedInstance('apple_pkpass_lib');
        }

        return new Apple_pkpass_lib();
    }
}
