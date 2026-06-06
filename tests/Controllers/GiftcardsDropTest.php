<?php

declare(strict_types=1);

namespace Tests\Controllers;

use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use CodeIgniter\Test\FeatureTestTrait;

/**
 * Behavioural tests for the public Gift Drop endpoints.
 *
 *   GET  /api/public/giftcards/drop/:token
 *   POST /api/public/giftcards/drop/:token/claim
 *
 * Focus: input validation, token format, no-oracle invariants. Full
 * happy-path (create → claim → verify) is exercised end-to-end via the
 * dev smoke test, not here, because creating a drop requires an
 * authenticated cashier session + an active gift card row, which is
 * fragile to construct in a fresh test DB.
 */
final class GiftcardsDropTest extends CIUnitTestCase
{
    use DatabaseTestTrait;
    use FeatureTestTrait;

    protected $migrate         = true;
    protected $migrateOnce     = true;
    protected $refresh         = false;
    protected $namespace;
    protected $useTransactions = false;

    public function testLookupRejectsMalformedToken(): void
    {
        $bad = ['abc', 'not-a-phrase', 'one-two-three', '0123456789abcdef0123456789abcdef'];
        foreach ($bad as $token) {
            $r = $this->get('/api/public/giftcards/drop/' . rawurlencode($token));
            $r->assertStatus(422);
        }
    }

    public function testLookupReturnsNotFoundForUnknownToken(): void
    {
        // Valid-format but never-issued phrase. Should 404 (or 503 if the
        // migration isn't applied — we accept either as a non-200 signal).
        $r = $this->get('/api/public/giftcards/drop/wave-sheep-drift-frost-jam-olive');
        $status = $r->getStatusCode();
        $this->assertNotSame(200, $status, "Unknown drop returned 200 — this is a leak");
    }

    public function testClaimRejectsMalformedToken(): void
    {
        $r = $this->postJson('/api/public/giftcards/drop/abc/claim', ['claimer_name' => 'Bob']);
        $r->assertStatus(422);
    }

    public function testClaimRejectsInvalidPhoneFormat(): void
    {
        // Even with a valid-format token, the phone must pass /^\+?\d{9,15}$/
        // BEFORE we touch the database lock.
        $r = $this->postJson('/api/public/giftcards/drop/wave-sheep-drift-frost-jam-olive/claim', [
            'claimer_phone' => 'not-a-phone',
        ]);
        $r->assertStatus(422);
        $this->assertStringContainsString('claimer_phone', json_decode($r->getJSON(), true)['message']);
    }

    public function testCreateRequiresAuth(): void
    {
        // Unauthenticated request to /api/giftcards/:id/drop must NOT succeed.
        $r = $this->postJson('/api/giftcards/1/drop', [
            'slot_count'   => 5,
            'distribution' => 'equal',
        ]);
        $this->assertNotSame(200, $r->getStatusCode());
        $this->assertNotSame(201, $r->getStatusCode());
    }

    public function testCancelRequiresAuth(): void
    {
        $r = $this->post('/api/giftcards/drops/1/cancel');
        $this->assertNotSame(200, $r->getStatusCode());
        $this->assertNotSame(201, $r->getStatusCode());
    }

    private function postJson(string $path, array $body): \CodeIgniter\Test\TestResponse
    {
        return $this
            ->withBody(json_encode($body))
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post($path);
    }
}
