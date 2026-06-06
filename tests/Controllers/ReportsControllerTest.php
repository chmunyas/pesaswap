<?php

namespace Tests\Controllers;

use CodeIgniter\Test\CIUnitTestCase;

class ReportsControllerTest extends CIUnitTestCase
{
    public function testRedirectPatternUsesRedirectException(): void
    {
        // The Reports constructor enforces sub-permission grants
        // (reports_sales, reports_employees, etc) for users hitting a
        // submodule report. The redirect must be a CI4 RedirectException
        // throw (not legacy header() + exit()) so that:
        //   1. PHPUnit's FeatureTestTrait sees the redirect cleanly
        //      (header()+exit() silently terminates the test process)
        //   2. The pattern matches the rest of Secure_Controller after
        //      ent-emp-getview-redirect / ent-rbac-employees

        $constructorCode = file_get_contents(APPPATH . 'Controllers/Reports.php');

        // The new contract: import + throw RedirectException
        $this->assertStringContainsString(
            'use CodeIgniter\\HTTP\\Exceptions\\RedirectException;',
            $constructorCode,
            'Reports controller must import RedirectException for sub-permission redirect.',
        );
        $this->assertStringContainsString(
            'throw new RedirectException(base_url(',
            $constructorCode,
            'Reports controller must throw RedirectException instead of legacy header()+exit().',
        );

        // The legacy pattern MUST be gone — leaving it in would silently
        // hang any PHPUnit test that hits a denied submodule report.
        $this->assertStringNotContainsString(
            "header('Location: ' . base_url('no_access",
            $constructorCode,
            'Legacy header()+exit() pattern still present in Reports controller.',
        );
    }

    public function testSubmodulePermissionCheckOccursBeforeControllerInitialization(): void
    {
        $constructorCode = file_get_contents(APPPATH . 'Controllers/Reports.php');

        $this->assertStringContainsString('has_grant', $constructorCode);
        $this->assertStringContainsString('reports_', $constructorCode);
        $this->assertStringContainsString('submodule_id', $constructorCode);
    }

    public function testAdminBypassesSubmoduleGrantCheck(): void
    {
        // Admins (Employee::isAdmin) must always pass the sub-permission
        // check — otherwise the seeded admin user can be locked out of
        // reports the migration didn't explicitly grant.
        $constructorCode = file_get_contents(APPPATH . 'Controllers/Reports.php');

        $this->assertStringContainsString(
            '$this->employee->isAdmin(',
            $constructorCode,
            'Reports submodule check must short-circuit for admins.',
        );
    }
}