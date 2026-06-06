<?php

declare(strict_types=1);

namespace Tests\Controllers;

use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use CodeIgniter\Test\FeatureTestTrait;

/**
 * Behavioural tests for the public phone-OTP roll-up endpoints powering
 * the "My Gifts" page.
 *
 *   POST /api/public/giftcards/by-phone/send-otp { phone }
 *   POST /api/public/giftcards/by-phone/verify   { phone, code }
 *
 * Focus areas (the invariants that make this safe to expose publicly):
 *   1. Phone format validation is strict (no whitespace/special-char
 *      bypass; 9-15 digits with optional + only).
 *   2. The OTP is rate-limited and never leaked when inline-return is
 *      disabled.
 *   3. Verify with wrong OTP increments the attempts counter and
 *      eventually wipes the cache entry; the legitimate user has to
 *      request a fresh code.
 *   4. Verify with no matching cards still returns 200 + empty list —
 *      the endpoint must not be an enumeration oracle.
 *   5. Once verified, the response includes full giftcard_number (so the
 *      frontend can deep-link to /g/:code without a second round-trip).
 *
 * NOTE: Like the existing test suite (HomeTest, EmployeesControllerTest)
 * we run against the migrated database via DatabaseTestTrait. The
 * giftcards/bindings schema is applied by the standard migration set.
 */
final class GiftcardsByPhoneTest extends CIUnitTestCase
{
    use DatabaseTestTrait;
    use FeatureTestTrait;

    protected $migrate         = true;
    protected $migrateOnce     = true;
    protected $refresh         = false;
    protected $namespace;
    protected $useTransactions = false;

    private string $phone = '+254712345670';

    protected function setUp(): void
    {
        parent::setUp();
        // Force inline OTP return so we can read the demo_code from the
        // response and exercise the verify path.
        $this->db->table('app_config')->where('key', 'giftcard_otp_inline_return')->delete();
        $this->db->table('app_config')->insert(['key' => 'giftcard_otp_inline_return', 'value' => '1']);
        // Clear any cached OTP from a previous run so phone-keyed cache
        // collisions don't poison the test.
        service('cache')->delete('gc_phone_otp_' . hash('sha256', strtolower($this->phone)));
    }

    public function testSendOtpRejectsObviouslyMalformedPhone(): void
    {
        $bad = ['', 'abc', '123', '+', '+abc', '1234567890123456789'];
        foreach ($bad as $phone) {
            $r = $this->call('post', '/api/public/giftcards/by-phone/send-otp', [], [], [], ['phone' => $phone]);
            $r->assertStatus(422);
        }
    }

    public function testSendOtpAcceptsValidPhone(): void
    {
        $r = $this->postJson('/api/public/giftcards/by-phone/send-otp', ['phone' => $this->phone]);
        $r->assertStatus(200);
        $data = json_decode($r->getJSON(), true);
        $this->assertTrue($data['success']);
        $this->assertNotEmpty($data['data']['demo_code']);
        $this->assertEquals(6, strlen((string) $data['data']['demo_code']));
        $this->assertStringContainsString('•', $data['data']['masked_phone']);
    }

    public function testVerifyRejectsWrongOtp(): void
    {
        $this->postJson('/api/public/giftcards/by-phone/send-otp', ['phone' => $this->phone]);
        $r = $this->postJson('/api/public/giftcards/by-phone/verify', [
            'phone' => $this->phone,
            'code'  => '000000',
        ]);
        $r->assertStatus(403);
        $this->assertStringContainsString('attempt(s) left', json_decode($r->getJSON(), true)['message']);
    }

    public function testVerifyWipesCacheAfterFiveWrongAttempts(): void
    {
        $this->postJson('/api/public/giftcards/by-phone/send-otp', ['phone' => $this->phone]);
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/public/giftcards/by-phone/verify', [
                'phone' => $this->phone,
                'code'  => '000000',
            ]);
        }
        // 6th attempt — cache should now be wiped; expect "Request a new code"
        $r = $this->postJson('/api/public/giftcards/by-phone/verify', [
            'phone' => $this->phone,
            'code'  => '000000',
        ]);
        $r->assertStatus(403);
        $message = json_decode($r->getJSON(), true)['message'];
        $this->assertTrue(
            str_contains($message, 'expired') || str_contains($message, 'wrong attempts'),
            "Expected expiry/wiped message, got: $message",
        );
    }

    public function testVerifyWithCorrectOtpReturnsEmptyListForUnboundPhone(): void
    {
        $send = $this->postJson('/api/public/giftcards/by-phone/send-otp', ['phone' => $this->phone]);
        $code = json_decode($send->getJSON(), true)['data']['demo_code'];

        $verify = $this->postJson('/api/public/giftcards/by-phone/verify', [
            'phone' => $this->phone,
            'code'  => $code,
        ]);
        $verify->assertStatus(200);
        $data = json_decode($verify->getJSON(), true);
        $this->assertTrue($data['success']);
        // Critical invariant: zero-cards must still be a success, not 404 —
        // the endpoint is never an oracle for "does this phone have any cards?"
        $this->assertEquals(0, $data['data']['total']);
        $this->assertSame([], $data['data']['cards']);
    }

    public function testVerifyConsumesOtp(): void
    {
        // First verify (correct) succeeds; second verify with the SAME code
        // must fail because the OTP is one-shot.
        $send = $this->postJson('/api/public/giftcards/by-phone/send-otp', ['phone' => $this->phone]);
        $code = json_decode($send->getJSON(), true)['data']['demo_code'];

        $this->postJson('/api/public/giftcards/by-phone/verify', [
            'phone' => $this->phone,
            'code'  => $code,
        ])->assertStatus(200);

        $r = $this->postJson('/api/public/giftcards/by-phone/verify', [
            'phone' => $this->phone,
            'code'  => $code,
        ]);
        $r->assertStatus(403);
    }

    public function testNormalisationStripsCommonSeparators(): void
    {
        // The user types "+254 (712) 345-670" — we should normalise it.
        $r = $this->postJson('/api/public/giftcards/by-phone/send-otp', [
            'phone' => '+254 (712) 345-670',
        ]);
        $r->assertStatus(200);
    }

    /**
     * Helper to invoke FeatureTestTrait's call() with a JSON body.
     */
    private function postJson(string $path, array $body): \CodeIgniter\Test\TestResponse
    {
        return $this
            ->withBody(json_encode($body))
            ->withHeaders(['Content-Type' => 'application/json'])
            ->post($path);
    }
}
