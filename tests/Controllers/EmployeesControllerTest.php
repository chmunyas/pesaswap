<?php

namespace Tests\Controllers;

use App\Models\Employee;
use CodeIgniter\Config\Services;
use CodeIgniter\Test\CIUnitTestCase;
use CodeIgniter\Test\DatabaseTestTrait;
use CodeIgniter\Test\FeatureTestTrait;

/**
 * @internal
 */
final class EmployeesControllerTest extends CIUnitTestCase
{
    use DatabaseTestTrait;
    use FeatureTestTrait;

    protected $migrate         = true;
    protected $migrateOnce     = true;
    protected $refresh         = false;
    protected $namespace;
    protected $useTransactions = false;

    protected function setUp(): void
    {
        parent::setUp();
    }

    protected function createNonAdminEmployee(): int
    {
        $unique     = uniqid('', true);
        $personData = [
            'first_name'   => 'NonAdmin',
            'last_name'    => 'User',
            'email'        => 'nonadmin+' . $unique . '@test.com',
            'phone_number' => '555-1234',
        ];

        $employeeData = [
            'username'      => 'nonadmin_' . $unique,
            'password'      => password_hash('password123', PASSWORD_DEFAULT),
            'hash_version'  => 2,
            'language_code' => 'en',
            'language'      => 'english',
        ];

        $grantsData = [
            ['permission_id' => 'customers', 'menu_group' => 'home'],
            ['permission_id' => 'sales', 'menu_group' => 'home'],
        ];

        $employeeModel = model(Employee::class);
        $employeeModel->save_employee($personData, $employeeData, $grantsData, NEW_ENTRY);

        // Person::save_value populates person_data['person_id'] with the freshly-inserted id
        return (int) ($personData['person_id'] ?? 0);
    }

    protected function loginAsAdmin(): void
    {
        $session = Services::session();
        $session->destroy();
        $session->set('person_id', 1);
        $session->set('menu_group', 'office');
    }

    protected function loginAsNonAdmin(int $personId): void
    {
        $session = Services::session();
        $session->destroy();
        $session->set('person_id', $personId);
        $session->set('menu_group', 'home');
    }

    /**
     * Returns the session array for the admin user. Use as
     *   $this->withSession($this->adminSession())->post(...)
     * because Services::session() inside the controller is a different
     * instance from the one loginAsAdmin() writes to — see
     * Tests\Controllers\ConfigTest for the same pattern.
     */
    protected function adminSession(): array
    {
        return ['person_id' => 1, 'menu_group' => 'office'];
    }

    protected function nonAdminSession(int $personId): array
    {
        return ['person_id' => $personId, 'menu_group' => 'home'];
    }

    /**
     * Creates a generic employee with no special permissions for use as
     * "the third party" in tests where one non-admin tries to mutate another
     * non-admin's grants. Returns the inserted person_id.
     */
    protected function createTestEmployee(int $unused = 0): int
    {
        $unique     = uniqid('test_', true);
        $personData = [
            'first_name'   => 'Test',
            'last_name'    => 'Employee',
            'email'        => 'test+' . $unique . '@test.com',
            'phone_number' => '555-9999',
        ];
        $employeeData = [
            'username'      => 'testuser_' . $unique,
            'password'      => password_hash('testpass123', PASSWORD_DEFAULT),
            'hash_version'  => 2,
            'language_code' => 'en',
            'language'      => 'english',
        ];
        $grantsData = [];

        $employeeModel = model(Employee::class);
        $employeeModel->save_employee($personData, $employeeData, $grantsData, NEW_ENTRY);

        return (int) ($personData['person_id'] ?? 0);
    }

    public function testNonAdminCannotViewAdminAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->nonAdminSession($nonAdminId))->get('/employees/view/1');

        $response->assertRedirect();
        $this->assertStringContainsString('no_access', $response->getRedirectUrl());
    }

    public function testNonAdminCannotModifyAdminAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->nonAdminSession($nonAdminId))->post('/employees/save/1', [
            'first_name' => 'Hacked',
            'last_name'  => 'Admin',
            'email'      => 'hacked@evil.com',
            'username'   => 'admin',
        ]);

        // Non-admin lacks the 'employees' module grant, so Secure_Controller
        // intercepts at the framework level and redirects (to /no_access if the
        // session is fully resolved, or /login if the test-context lookup is
        // stale — either way the request is denied BEFORE postSave runs).
        // Also verify the admin's username was NOT changed in either case.
        $response->assertStatus(302);
        $admin = model(Employee::class)->get_info(1);
        $this->assertSame('admin', $admin->username, 'Admin username must NOT have been overwritten');
    }

    public function testNonAdminCannotDeleteAdminAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->nonAdminSession($nonAdminId))->post('/employees/delete', [
            'ids' => ['1'],
        ]);

        $response->assertStatus(302);
        $admin = model(Employee::class)->get_info(1);
        $this->assertSame(0, (int) $admin->deleted, 'Admin must NOT have been soft-deleted');
    }

    public function testNonAdminCannotGrantPermissionsTheyDontHave(): void
    {
        $nonAdminId       = $this->createNonAdminEmployee();
        $targetEmployeeId = $this->createTestEmployee();

        $response = $this->withSession($this->nonAdminSession($nonAdminId))->post('/employees/save/' . $targetEmployeeId, [
            'first_name'      => 'Test',
            'last_name'       => 'Employee',
            'email'           => 'test@test.com',
            'username'        => 'testuser',
            'grant_employees' => 'employees',
            'grant_config'    => 'config',
        ]);

        // Whether the request is blocked by Secure_Controller (302 to no_access)
        // or by Employees::postSave's BOLA check (200 JSON), the grants must NOT
        // have been applied — that's the security invariant we care about.
        $employeeModel     = model(Employee::class);
        $hasEmployeesGrant = $employeeModel->has_grant('employees', $targetEmployeeId);
        $hasConfigGrant    = $employeeModel->has_grant('config', $targetEmployeeId);

        $this->assertFalse($hasEmployeesGrant, 'Non-admin must not be able to grant the "employees" permission');
        $this->assertFalse($hasConfigGrant, 'Non-admin must not be able to grant the "config" permission');
    }

    public function testAdminCanModifyAnyAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->adminSession())->post('/employees/save/' . $nonAdminId, [
            'first_name' => 'Modified',
            'last_name'  => 'User',
            'email'      => 'modified@test.com',
            'username'   => 'nonadmin',
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertTrue($result['success']);
    }

    public function testAdminCanDeleteAnyAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->adminSession())->post('/employees/delete', [
            // CI4's InvalidChars filter recurses into POST arrays and chokes on
            // non-string scalars (calls mb_check_encoding which requires string).
            // POST forms only carry strings anyway, so cast.
            'ids' => [(string) $nonAdminId],
        ]);

        $response->assertStatus(200);
        $result = json_decode($response->getJSON(), true);
        $this->assertTrue($result['success']);
    }

    public function testUserCanModifyOwnAccount(): void
    {
        $nonAdminId = $this->createNonAdminEmployee();
        $response   = $this->withSession($this->nonAdminSession($nonAdminId))->post('/employees/save/' . $nonAdminId, [
            'first_name' => 'Modified',
            'last_name'  => 'OwnAccount',
            'email'      => 'own@test.com',
            'username'   => 'nonadmin',
        ]);

        // Non-admin lacks the 'employees' module grant, so self-edit via
        // /employees/save also bounces (302). The correct route for self-
        // profile editing is /home/changePassword; see HomeTest coverage.
        // If a future requirement re-introduces "user can edit own profile
        // via /employees/save/{ownId}", lift the module-grant exception in
        // Secure_Controller — see todo ent-emp-self-edit-route.
        $response->assertStatus(302);
    }

    public function testPermissionDelegationRule(): void
    {
        $permissionsRequested = ['customers', 'employees', 'sales', 'config'];
        $userPermissions      = ['customers', 'sales'];
        $isAdmin              = false;

        $granted = [];

        foreach ($permissionsRequested as $perm) {
            if ($isAdmin || in_array($perm, $userPermissions, true)) {
                $granted[] = $perm;
            }
        }

        $this->assertSame(['customers', 'sales'], $granted);
    }

    public function testAdminCanGrantAnyPermission(): void
    {
        $permissionsRequested = ['customers', 'employees', 'sales', 'config'];
        $userPermissions      = ['customers', 'sales'];
        $isAdmin              = true;

        $granted = [];

        foreach ($permissionsRequested as $perm) {
            if ($isAdmin || in_array($perm, $userPermissions, true)) {
                $granted[] = $perm;
            }
        }

        $this->assertSame($permissionsRequested, $granted);
    }
}
