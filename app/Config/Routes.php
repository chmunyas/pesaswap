<?php

use CodeIgniter\Router\RouteCollection;

/**
 * @var RouteCollection $routes
 */
$routes->setDefaultController('Login');

$routes->get('/', 'Login::index');
$routes->get('login', 'Login::index');
$routes->post('login', 'Login::index');
$routes->post('migrate', 'Login::migrate');

$routes->add('no_access/index/(:segment)', 'No_access::index/$1');
$routes->add('no_access/index/(:segment)/(:segment)', 'No_access::index/$1/$2');

$routes->add('reports/summary_(:any)/(:any)/(:any)', 'Reports::Summary_$1/$2/$3/$4');
$routes->add('reports/summary_expenses_categories', 'Reports::date_input_only');
$routes->add('reports/summary_payments', 'Reports::date_input_only');
$routes->add('reports/summary_discounts', 'Reports::summary_discounts_input');
$routes->add('reports/summary_(:any)', 'Reports::date_input');

$routes->add('reports/graphical_(:any)/(:any)/(:any)', 'Reports::Graphical_$1/$2/$3/$4');
$routes->add('reports/graphical_summary_expenses_categories', 'Reports::date_input_only');
$routes->add('reports/graphical_summary_discounts', 'Reports::summary_discounts_input');
$routes->add('reports/graphical_(:any)', 'Reports::date_input');

$routes->add('reports/inventory_(:any)/(:any)', 'Reports::Inventory_$1/$2');
$routes->add('reports/inventory_low', 'Reports::inventory_low');
$routes->add('reports/inventory_summary', 'Reports::inventory_summary_input');
$routes->add('reports/inventory_summary/(:any)/(:any)/(:any)', 'Reports::inventory_summary/$1/$2/$3');

$routes->add('reports/detailed_(:any)/(:any)/(:any)/(:any)', 'Reports::Detailed_$1/$2/$3/$4');
$routes->add('reports/detailed_sales', 'Reports::date_input_sales');
$routes->add('reports/detailed_receivings', 'Reports::date_input_recv');

$routes->add('reports/specific_(:any)/(:any)/(:any)/(:any)', 'Reports::Specific_$1/$2/$3/$4');
$routes->add('reports/specific_customers', 'Reports::specific_customer_input');
$routes->add('reports/specific_employees', 'Reports::specific_employee_input');
$routes->add('reports/specific_discounts', 'Reports::specific_discount_input');
$routes->add('reports/specific_suppliers', 'Reports::specific_supplier_input');

// Public ticket claim/verify page (no auth). Token is the full JWT.
$routes->get('t/(:any)', 'Ticket_public::show/$1');

// API Routes
$routes->group('api', static function ($routes) {
    $routes->post('auth/login', 'Api\AuthController::login');
    $routes->post('auth/logout', 'Api\AuthController::logout');
    $routes->get('auth/me', 'Api\AuthController::me');

    $routes->get('dashboard/stats', 'Api\DashboardController::stats');

    $routes->get('dinner-tables', 'Api\DinnerTablesController::index');
    $routes->put('dinner-tables/(:num)/status', 'Api\DinnerTablesController::updateStatus/$1');

    $routes->get('items', 'Api\ItemsController::index');
    $routes->get('items/(:num)', 'Api\ItemsController::show/$1');
    $routes->post('items', 'Api\ItemsController::create');
    $routes->put('items/(:num)', 'Api\ItemsController::update/$1');
    $routes->delete('items/(:num)', 'Api\ItemsController::delete/$1');

    $routes->get('sales', 'Api\SalesController::index');
    $routes->get('sales/(:num)', 'Api\SalesController::show/$1');

    $routes->get('customers', 'Api\CustomersController::index');
    $routes->get('customers/(:num)', 'Api\CustomersController::show/$1');
    $routes->post('customers', 'Api\CustomersController::create');
    $routes->put('customers/(:num)', 'Api\CustomersController::update/$1');
    $routes->delete('customers/(:num)', 'Api\CustomersController::delete/$1');

    $routes->get('suppliers', 'Api\SuppliersController::index');
    $routes->get('suppliers/(:num)', 'Api\SuppliersController::show/$1');
    $routes->post('suppliers', 'Api\SuppliersController::create');
    $routes->put('suppliers/(:num)', 'Api\SuppliersController::update/$1');
    $routes->delete('suppliers/(:num)', 'Api\SuppliersController::delete/$1');

    $routes->get('receivings', 'Api\ReceivingsController::index');
    $routes->get('receivings/(:num)', 'Api\ReceivingsController::show/$1');

    $routes->get('giftcards', 'Api\GiftcardsController::index');
    $routes->get('giftcards/(:num)', 'Api\GiftcardsController::show/$1');
    $routes->post('giftcards', 'Api\GiftcardsController::create');
    $routes->put('giftcards/(:num)', 'Api\GiftcardsController::update/$1');
    $routes->delete('giftcards/(:num)', 'Api\GiftcardsController::delete/$1');
    $routes->get('giftcards/(:num)/history', 'Api\GiftcardsController::history/$1');
    $routes->post('giftcards/(:num)/redeem', 'Api\GiftcardsController::redeem/$1');
    $routes->post('giftcards/(:num)/refund', 'Api\GiftcardsController::refund/$1');
    $routes->post('giftcards/(:num)/adjust', 'Api\GiftcardsController::adjust/$1');
    $routes->post('giftcards/(:num)/topup', 'Api\GiftcardsController::topup/$1');
    $routes->post('giftcards/(:num)/resend-email', 'Api\GiftcardsController::resendEmail/$1');

    $routes->get('expenses', 'Api\ExpensesController::index');
    $routes->post('expenses', 'Api\ExpensesController::create');
    $routes->delete('expenses/(:num)', 'Api\ExpensesController::delete/$1');

    $routes->get('cashups', 'Api\CashupsController::index');
    $routes->get('cashups/(:num)', 'Api\CashupsController::show/$1');
    $routes->post('cashups', 'Api\CashupsController::open');
    $routes->post('cashups/(:num)/close', 'Api\CashupsController::close/$1');
    $routes->delete('cashups/(:num)', 'Api\CashupsController::delete/$1');

    $routes->get('config', 'Api\ConfigController::index');
    $routes->post('config', 'Api\ConfigController::save');

    $routes->get('reports/summary', 'Api\ReportsController::summary');

    $routes->get('item-kits', 'Api\ItemKitsController::index');
    $routes->get('item-kits/(:num)', 'Api\ItemKitsController::show/$1');
    $routes->post('item-kits', 'Api\ItemKitsController::create');
    $routes->put('item-kits/(:num)', 'Api\ItemKitsController::update/$1');
    $routes->delete('item-kits/(:num)', 'Api\ItemKitsController::delete/$1');

    $routes->get('messages', 'Api\MessagesController::index');

    $routes->post('ai/chat', 'Api\AiController::chat');

    // Tickets — Phase 1 API
    $routes->get('ticket-products', 'Api\TicketsController::productIndex');
    $routes->get('ticket-products/(:num)', 'Api\TicketsController::productShow/$1');
    $routes->post('ticket-products', 'Api\TicketsController::productCreate');
    $routes->put('ticket-products/(:num)', 'Api\TicketsController::productUpdate/$1');
    $routes->delete('ticket-products/(:num)', 'Api\TicketsController::productDelete/$1');

    $routes->get('tickets', 'Api\TicketsController::ticketIndex');
    $routes->get('tickets/(:num)', 'Api\TicketsController::ticketShow/$1');
    $routes->post('tickets', 'Api\TicketsController::ticketIssue');
    $routes->post('tickets/redeem', 'Api\TicketsController::ticketRedeem');
    $routes->post('tickets/(:num)/revoke', 'Api\TicketsController::ticketRevoke/$1');
    $routes->post('tickets/(:num)/refund', 'Api\TicketsController::ticketRefund/$1');
    $routes->get('tickets/(:num)/qr', 'Api\TicketsController::ticketQr/$1');

    // PUBLIC endpoints — no auth required. Customer-safe data only.
    $routes->get('public/menu/(:segment)', 'Api\PublicController::menu/$1');
    $routes->get('public/giftcards/balance/(:segment)', 'Api\PublicController::giftcardBalance/$1');
    $routes->get('public/tickets/(:segment)', 'Api\PublicController::ticketLookup/$1');

    $routes->options('auth/login', 'Api\AuthController::preflight');
    $routes->options('auth/logout', 'Api\AuthController::preflight');
    $routes->options('auth/me', 'Api\AuthController::preflight');
    $routes->options('dashboard/stats', 'Api\DashboardController::preflight');
    $routes->options('items', 'Api\ItemsController::preflight');
    $routes->options('items/(:num)', 'Api\ItemsController::preflight');
    $routes->options('sales', 'Api\SalesController::preflight');
    $routes->options('sales/(:num)', 'Api\SalesController::preflight');
    $routes->options('customers', 'Api\CustomersController::preflight');
    $routes->options('customers/(:num)', 'Api\CustomersController::preflight');
    $routes->options('suppliers', 'Api\SuppliersController::preflight');
    $routes->options('suppliers/(:num)', 'Api\SuppliersController::preflight');
    $routes->options('receivings', 'Api\ReceivingsController::preflight');
    $routes->options('receivings/(:num)', 'Api\ReceivingsController::preflight');
    $routes->options('giftcards', 'Api\GiftcardsController::preflight');
    $routes->options('giftcards/(:num)', 'Api\GiftcardsController::preflight');
    $routes->options('giftcards/(:num)/(:any)', 'Api\GiftcardsController::preflight');
    $routes->options('public/giftcards/balance/(:segment)', 'Api\PublicController::preflight');
    $routes->options('expenses', 'Api\ExpensesController::preflight');
    $routes->options('cashups', 'Api\CashupsController::preflight');
    $routes->options('cashups/(:num)', 'Api\CashupsController::preflight');
    $routes->options('cashups/(:num)/close', 'Api\CashupsController::preflight');
    $routes->options('reports/summary', 'Api\ReportsController::preflight');
    $routes->options('item-kits', 'Api\ItemKitsController::preflight');
    $routes->options('item-kits/(:num)', 'Api\ItemKitsController::preflight');
    $routes->options('messages', 'Api\MessagesController::preflight');
    $routes->options('ai/chat', 'Api\AiController::preflight');
    $routes->options('public/menu/(:segment)', 'Api\PublicController::preflight');
    $routes->options('ticket-products', 'Api\TicketsController::preflight');
    $routes->options('ticket-products/(:num)', 'Api\TicketsController::preflight');
    $routes->options('tickets', 'Api\TicketsController::preflight');
    $routes->options('tickets/(:num)', 'Api\TicketsController::preflight');
    $routes->options('tickets/(:num)/(:any)', 'Api\TicketsController::preflight');
    $routes->options('tickets/redeem', 'Api\TicketsController::preflight');
    $routes->options('public/tickets/(:segment)', 'Api\PublicController::preflight');
});
