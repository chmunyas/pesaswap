<?php

namespace Tests\Libraries;

use App\Libraries\Pii_crypto;
use CodeIgniter\Test\CIUnitTestCase;
use RuntimeException;

/**
 * Behavioural coverage for the PII envelope encryption helper.
 *
 * Master key is injected via putenv() because the helper resolves
 * through Secrets_vault → env > _FILE > app_config. Using env keeps
 * tests hermetic (no DB writes for the key itself).
 */
final class Pii_cryptoTest extends CIUnitTestCase
{
    private const TEST_KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    private Pii_crypto $crypto;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('PII_MASTER_KEY=' . self::TEST_KEY_HEX);
        service('secrets_vault')->flush();
        $this->crypto = new Pii_crypto();
    }

    protected function tearDown(): void
    {
        putenv('PII_MASTER_KEY');
        service('secrets_vault')->flush();
        parent::tearDown();
    }

    public function testEncryptDecryptRoundTrip(): void
    {
        $plain = 'john.doe@example.com';
        $env   = $this->crypto->encrypt($plain);
        $this->assertNotNull($env);
        $this->assertStringStartsWith('v01.', $env);
        $this->assertSame($plain, $this->crypto->decrypt($env));
    }

    public function testEncryptOfNullReturnsNull(): void
    {
        $this->assertNull($this->crypto->encrypt(null));
    }

    public function testDecryptOfNullOrEmptyReturnsNull(): void
    {
        $this->assertNull($this->crypto->decrypt(null));
        $this->assertNull($this->crypto->decrypt(''));
    }

    public function testEncryptOfSameInputProducesDifferentCiphertext(): void
    {
        // Different random IV each call → different envelopes,
        // but same plaintext on round-trip.
        $a = $this->crypto->encrypt('same input');
        $b = $this->crypto->encrypt('same input');
        $this->assertNotSame($a, $b);
        $this->assertSame($this->crypto->decrypt($a), $this->crypto->decrypt($b));
    }

    public function testTamperedCiphertextReturnsNullNotError(): void
    {
        $env = (string) $this->crypto->encrypt('secret');
        // Flip a bit in the ciphertext portion (index 2 after split)
        $parts = explode('.', $env);
        $ct = $parts[2];
        $parts[2] = $ct === 'a' ? 'b' : substr($ct, 0, 5) . 'AAAA' . substr($ct, 9);
        $tampered = implode('.', $parts);
        $this->assertNull($this->crypto->decrypt($tampered));
    }

    public function testMalformedEnvelopeReturnsNull(): void
    {
        $this->assertNull($this->crypto->decrypt('not-an-envelope'));
        $this->assertNull($this->crypto->decrypt('v01.short'));
        $this->assertNull($this->crypto->decrypt('v99.aaa.bbb.ccc'));
    }

    public function testHashLookupIsDeterministicAndKeyed(): void
    {
        $a = $this->crypto->hashLookup('alice@example.com');
        $b = $this->crypto->hashLookup('alice@example.com');
        $this->assertSame($a, $b, 'Same input must hash the same way');
        $this->assertNotSame($a, $this->crypto->hashLookup('bob@example.com'));
        // HMAC, not raw SHA256 → 64 hex chars
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', (string) $a);
    }

    public function testHashLookupOfNullOrEmptyReturnsNull(): void
    {
        $this->assertNull($this->crypto->hashLookup(null));
        $this->assertNull($this->crypto->hashLookup(''));
    }

    public function testIsConfiguredTrueWhenKeyPresent(): void
    {
        $this->assertTrue($this->crypto->isConfigured());
    }

    public function testIsConfiguredFalseWhenKeyAbsent(): void
    {
        putenv('PII_MASTER_KEY');
        service('secrets_vault')->flush();
        $fresh = new Pii_crypto();
        $this->assertFalse($fresh->isConfigured());
    }

    public function testEncryptThrowsWhenKeyAbsent(): void
    {
        putenv('PII_MASTER_KEY');
        service('secrets_vault')->flush();
        $fresh = new Pii_crypto();
        $this->expectException(RuntimeException::class);
        $fresh->encrypt('cannot-encrypt-without-key');
    }

    public function testKeyAcceptsBase64Format(): void
    {
        // 32 raw bytes encoded as standard base64 (44 chars incl '=' padding)
        $raw = random_bytes(32);
        putenv('PII_MASTER_KEY=' . base64_encode($raw));
        service('secrets_vault')->flush();
        $fresh = new Pii_crypto();
        $this->assertTrue($fresh->isConfigured());
        $this->assertSame('test', $fresh->decrypt((string) $fresh->encrypt('test')));
    }

    public function testRoundTripPreservesUnicodeAndBinary(): void
    {
        $cases = [
            'unicode'       => '北京电话 +86 13800138000',
            'newlines'      => "line1\nline2\r\nline3",
            'binary-ish'    => "\x00\x01\x02\xff",
            'long'          => str_repeat('A', 4096),
        ];
        foreach ($cases as $label => $input) {
            $this->assertSame($input, $this->crypto->decrypt((string) $this->crypto->encrypt($input)), $label);
        }
    }
}
