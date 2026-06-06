<?php

declare(strict_types=1);

namespace Tests\Libraries;

use App\Libraries\SmsSender;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;

/**
 * Tests for the SmsSender library — focuses on the mock provider plus
 * the phone normalisation + masking helpers that ALL providers share.
 * Real provider integrations (Africa's Talking, Twilio, http_proxy) hit
 * external services and are exercised manually with real credentials.
 *
 * The mock provider is the production safety net: if a merchant
 * forgets to configure sms_provider, the library defaults to mock so
 * no SMS is sent (and no credit burned) — but the calling code still
 * receives an ok=true envelope so the wider flow proceeds.
 */
final class SmsSenderTest extends CIUnitTestCase
{
    use DatabaseTestTrait;

    protected $migrate         = true;
    protected $migrateOnce     = true;
    protected $refresh         = false;
    protected $namespace;
    protected $useTransactions = false;

    private SmsSender $sms;

    protected function setUp(): void
    {
        parent::setUp();
        $this->sms = new SmsSender();
        // Force mock provider for these tests so we don't hit real APIs.
        $this->db->table('app_config')->where('key', 'sms_provider')->delete();
        $this->db->table('app_config')->insert(['key' => 'sms_provider', 'value' => 'mock']);
    }

    public function testNormalisePhoneStripsSeparators(): void
    {
        $this->assertSame('+254712345678', $this->sms->normalisePhone('+254 712 345 678'));
        $this->assertSame('+254712345678', $this->sms->normalisePhone('+254-712-345-678'));
        $this->assertSame('+254712345678', $this->sms->normalisePhone('+254 (712) 345-678'));
        $this->assertSame('254712345678',  $this->sms->normalisePhone('254 712 345 678'));
    }

    public function testNormalisePhoneRejectsObviousBadInput(): void
    {
        $this->assertSame('', $this->sms->normalisePhone(''));
        $this->assertSame('', $this->sms->normalisePhone('abc'));
        $this->assertSame('', $this->sms->normalisePhone('123'));
        $this->assertSame('', $this->sms->normalisePhone('+'));
        $this->assertSame('', $this->sms->normalisePhone('+abc'));
    }

    public function testMaskPhoneAlwaysKeepsLastFourDigits(): void
    {
        $masked = $this->sms->maskPhone('+254712345678');
        // The exact format doesn't matter — last 4 digits must appear.
        $this->assertStringEndsWith('5678', $masked);
        $this->assertStringContainsString('•', $masked);
        $this->assertStringNotContainsString('345', $masked);
    }

    public function testMockProviderAlwaysOk(): void
    {
        $r = $this->sms->send('+254712345678', 'Hello from test');
        $this->assertTrue($r['ok']);
        $this->assertSame('mock', $r['provider']);
        $this->assertNotEmpty($r['message_id']);
        $this->assertStringStartsWith('mock-', (string)$r['message_id']);
    }

    public function testSendRefusesInvalidPhone(): void
    {
        $r = $this->sms->send('not-a-phone', 'Hello');
        $this->assertFalse($r['ok']);
        $this->assertSame('invalid phone', $r['error']);
    }

    public function testSendRefusesEmptyMessage(): void
    {
        $r = $this->sms->send('+254712345678', '');
        $this->assertFalse($r['ok']);
        $this->assertSame('empty message', $r['error']);
    }

    public function testAfricasTalkingRefusesWithoutCredentials(): void
    {
        $this->db->table('app_config')->where('key', 'sms_provider')->delete();
        $this->db->table('app_config')->insert(['key' => 'sms_provider', 'value' => 'africastalking']);
        $r = $this->sms->send('+254712345678', 'Hello');
        $this->assertFalse($r['ok']);
        $this->assertSame('africastalking', $r['provider']);
        $this->assertStringContainsString('not configured', (string)$r['error']);
    }

    public function testTwilioRefusesWithoutCredentials(): void
    {
        $this->db->table('app_config')->where('key', 'sms_provider')->delete();
        $this->db->table('app_config')->insert(['key' => 'sms_provider', 'value' => 'twilio']);
        $r = $this->sms->send('+254712345678', 'Hello');
        $this->assertFalse($r['ok']);
        $this->assertSame('twilio', $r['provider']);
        $this->assertStringContainsString('not configured', (string)$r['error']);
    }

    public function testHttpProxyRefusesWithoutUrl(): void
    {
        $this->db->table('app_config')->where('key', 'sms_provider')->delete();
        $this->db->table('app_config')->insert(['key' => 'sms_provider', 'value' => 'http_proxy']);
        $r = $this->sms->send('+254712345678', 'Hello');
        $this->assertFalse($r['ok']);
        $this->assertSame('http_proxy', $r['provider']);
        $this->assertStringContainsString('sms_proxy_url not configured', (string)$r['error']);
    }
}
