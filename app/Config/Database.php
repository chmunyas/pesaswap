<?php

namespace Config;

use CodeIgniter\Database\Config;

/**
 * Database Configuration
 */
class Database extends Config
{
    /**
     * The directory that holds the Migrations and Seeds directories.
     */
    public string $filesPath = APPPATH . 'Database' . DIRECTORY_SEPARATOR;

    /**
     * Lets you choose which connection group to use if no other is specified.
     */
    public string $defaultGroup = 'default';

    /**
     * The default database connection.
     *
     * @var array<string, mixed>
     */
    public array $default = [
        'DSN'          => '',
        'hostname'     => 'localhost',
        'username'     => 'admin',
        'password'     => 'pointofsale',
        'database'     => 'ospos',
        'DBDriver'     => 'MySQLi',
        'DBPrefix'     => 'ospos_',
        'pConnect'     => false,
        'DBDebug'      => (ENVIRONMENT !== 'production'),
        'charset'      => 'utf8mb4',
        'DBCollat'     => 'utf8mb4_general_ci',
        'swapPre'      => '',
        'encrypt'      => false,
        'compress'     => false,
        'strictOn'     => false,
        'failover'     => [],
        'port'         => 3306,
        'numberNative' => false,
        'foundRows'    => false,
        'dateFormat'   => [
            'date'     => 'Y-m-d',
            'datetime' => 'Y-m-d H:i:s',
            'time'     => 'H:i:s',
        ],
    ];

    /**
     * This database connection is used when running PHPUnit database tests.
     *
     * Uses a SEPARATE `ospos_test` database so DatabaseTestTrait's refresh
     * + migrate flow can drop+rebuild without touching dev data, and so
     * legacy SQL-script migrations that don't have a clean down() don't
     * collide with the already-populated dev schema.
     *
     * Hostname `mysql` matches the docker-compose service name — these
     * tests are intended to run via:
     *     docker compose exec -T ospos composer test
     * so the test process shares the container's network namespace.
     *
     * Bootstrap the test DB (one-time):
     *     docker compose exec mysql sh -c \
     *         'mysql -uroot -ppointofsale -e "CREATE DATABASE ospos_test;
     *          GRANT ALL ON ospos_test.* TO admin@\"%\";"'
     *
     * @var array<string, mixed>
     */
    public array $tests = [
        'DSN'         => '',
        'hostname'    => 'mysql',
        'username'    => 'admin',
        'password'    => 'pointofsale',
        'database'    => 'ospos_test',
        'DBDriver'    => 'MySQLi',
        'DBPrefix'    => 'ospos_',
        'pConnect'    => false,
        'DBDebug'     => (ENVIRONMENT !== 'production'),
        'charset'     => 'utf8mb4',
        'DBCollat'    => 'utf8mb4_general_ci',
        'swapPre'     => '',
        'encrypt'     => false,
        'compress'    => false,
        'strictOn'    => false,
        'failover'    => [],
        'port'        => 3306,
        'foreignKeys' => true,
        'busyTimeout' => 1000,
        'synchronous' => null,
        'dateFormat'  => [
            'date'     => 'Y-m-d',
            'datetime' => 'Y-m-d H:i:s',
            'time'     => 'H:i:s',
        ],
    ];

    /**
     * This database connection is used when developing against non-production data.
     *
     * @var array
     */
    public $development = [
        'DSN'          => '',
        'hostname'     => 'localhost',
        'username'     => 'admin',
        'password'     => 'pointofsale',
        'database'     => 'ospos',
        'DBDriver'     => 'MySQLi',
        'DBPrefix'     => 'ospos_',
        'pConnect'     => false,
        'DBDebug'      => (ENVIRONMENT !== 'production'),
        'charset'      => 'utf8mb4',
        'DBCollat'     => 'utf8mb4_general_ci',
        'swapPre'      => '',
        'encrypt'      => false,
        'compress'     => false,
        'strictOn'     => false,
        'failover'     => [],
        'port'         => 3306,
        'foreignKeys'  => true,
        'busyTimeout'  => 1000,
        'dateFormat'   => [
            'date'     => 'Y-m-d',
            'datetime' => 'Y-m-d H:i:s',
            'time'     => 'H:i:s',
        ],
    ];

    public function __construct()
    {
        parent::__construct();

        // Ensure that we always set the database group to 'tests' if
        // we are currently running an automated test suite, so that
        // we don't overwrite live data on accident.
        switch (ENVIRONMENT) {
            case 'testing':
                $this->defaultGroup = 'tests';
                break;
            case 'development';
                $this->defaultGroup = 'development';
                break;
        }

        foreach ([&$this->development, &$this->tests, &$this->default] as &$config) {
            $config['hostname'] = !getenv('MYSQL_HOST_NAME') ? $config['hostname'] : getenv('MYSQL_HOST_NAME');
            $config['username'] = !getenv('MYSQL_USERNAME') ? $config['username'] : getenv('MYSQL_USERNAME');
            $config['password'] = !getenv('MYSQL_PASSWORD') ? $config['password'] : getenv('MYSQL_PASSWORD');
            $config['database'] = !getenv('MYSQL_DB_NAME') ? $config['database'] : getenv('MYSQL_DB_NAME');
        }
    }
}
