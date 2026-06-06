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
    $routes->post('sales', 'Api\SalesController::create');

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
    // Send-as-gift transfer flow (modernization)
    $routes->post('giftcards/(:num)/transfer', 'Api\GiftcardsController::transferRequest/$1');
    $routes->get('giftcards/(:num)/transfers', 'Api\GiftcardsController::transferList/$1');
    $routes->delete('giftcards/(:num)/transfers/(:num)', 'Api\GiftcardsController::transferCancel/$1/$2');

    // NFC binding + payment intents (Phase 6)
    $routes->get('giftcards/(:num)/bindings', 'Api\GiftcardsController::bindingIndex/$1');
    $routes->post('giftcards/(:num)/bind', 'Api\GiftcardsController::bind/$1');
    $routes->delete('giftcards/(:num)/bind', 'Api\GiftcardsController::unbind/$1');
    $routes->post('giftcards/(:num)/payment-intent', 'Api\GiftcardsController::createIntent/$1');
    $routes->get('giftcards/(:num)/payment-intent/(:num)', 'Api\GiftcardsController::showIntent/$1/$2');
    $routes->post('giftcards/(:num)/payment-intent/(:num)/cancel', 'Api\GiftcardsController::cancelIntent/$1/$2');

    // MNO webhook (signed; signature optional in dev mode)
    $routes->post('webhooks/mno/(:segment)', 'Api\GiftcardsController::mnoCallback/$1');

    // Design templates (admin)
    $routes->get('giftcard-designs', 'Api\GiftcardsController::designIndex');
    $routes->get('giftcard-designs/(:num)', 'Api\GiftcardsController::designShow/$1');
    $routes->post('giftcard-designs', 'Api\GiftcardsController::designCreate');
    $routes->put('giftcard-designs/(:num)', 'Api\GiftcardsController::designUpdate/$1');
    $routes->delete('giftcard-designs/(:num)', 'Api\GiftcardsController::designDelete/$1');

    // Preset denominations (admin)
    $routes->get('giftcard-denominations', 'Api\GiftcardsController::denominationIndex');
    $routes->post('giftcard-denominations', 'Api\GiftcardsController::denominationCreate');
    $routes->put('giftcard-denominations/(:num)', 'Api\GiftcardsController::denominationUpdate/$1');
    $routes->delete('giftcard-denominations/(:num)', 'Api\GiftcardsController::denominationDelete/$1');

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
    $routes->put('tickets/(:num)/assign', 'Api\TicketsController::ticketAssign/$1');
    $routes->post('tickets/(:num)/resend-delivery', 'Api\TicketsController::ticketResendDelivery/$1');
    $routes->get('tickets/(:num)/qr', 'Api\TicketsController::ticketQr/$1');

    // Tickets — Phase 2: sessions + tiers per product
    $routes->get('ticket-products/(:num)/sessions', 'Api\TicketsController::sessionIndex/$1');
    $routes->get('ticket-products/(:num)/sessions/(:num)', 'Api\TicketsController::sessionShow/$1/$2');
    $routes->post('ticket-products/(:num)/sessions', 'Api\TicketsController::sessionCreate/$1');
    $routes->put('ticket-products/(:num)/sessions/(:num)', 'Api\TicketsController::sessionUpdate/$1/$2');
    $routes->delete('ticket-products/(:num)/sessions/(:num)', 'Api\TicketsController::sessionDelete/$1/$2');
    $routes->get('ticket-products/(:num)/tiers', 'Api\TicketsController::tierIndex/$1');
    $routes->get('ticket-products/(:num)/tiers/(:num)', 'Api\TicketsController::tierShow/$1/$2');
    $routes->post('ticket-products/(:num)/tiers', 'Api\TicketsController::tierCreate/$1');
    $routes->put('ticket-products/(:num)/tiers/(:num)', 'Api\TicketsController::tierUpdate/$1/$2');
    $routes->delete('ticket-products/(:num)/tiers/(:num)', 'Api\TicketsController::tierDelete/$1/$2');

    // Tickets — Phase 3: translations
    $routes->get('ticket-products/(:num)/translations', 'Api\TicketsController::translationIndex/$1');
    $routes->post('ticket-products/(:num)/translations', 'Api\TicketsController::translationUpsert/$1');
    $routes->delete('ticket-products/(:num)/translations/(:segment)', 'Api\TicketsController::translationDelete/$1/$2');

    // Tickets — Phase 4: scanner devices + dashboard + bulk-issue
    $routes->get('tickets/scanner-devices', 'Api\TicketsController::scannerDeviceIndex');
    $routes->post('tickets/scanner-devices', 'Api\TicketsController::scannerDeviceCreate');
    $routes->post('tickets/scanner-devices/(:num)/revoke', 'Api\TicketsController::scannerDeviceRevoke/$1');
    $routes->get('tickets/dashboard', 'Api\TicketsController::ticketDashboard');
    $routes->post('tickets/bulk-issue', 'Api\TicketsController::ticketBulkIssue');
    // Admin audit log (ent-admin-audit-log)
    $routes->get('admin/audit-log', 'Api\TicketsController::auditLogIndex');
    // Prometheus metrics (ent-metrics-prometheus)
    $routes->get('metrics', 'Api\MetricsController::scrape');
    // Health + readiness (ent-graceful-shutdown)
    $routes->get('health', 'Api\HealthController::check');

    // Tickets — Phase 5: promos + bundles + seat holds + reports
    $routes->get('ticket-promos', 'Api\TicketsController::promoIndex');
    $routes->post('ticket-promos', 'Api\TicketsController::promoCreate');
    $routes->put('ticket-promos/(:num)', 'Api\TicketsController::promoUpdate/$1');
    $routes->delete('ticket-promos/(:num)', 'Api\TicketsController::promoDelete/$1');
    $routes->post('ticket-promos/validate', 'Api\TicketsController::promoValidate');
    $routes->get('ticket-products/(:num)/bundles', 'Api\TicketsController::bundleIndex/$1');
    $routes->post('ticket-products/(:num)/bundles', 'Api\TicketsController::bundleCreate/$1');
    $routes->delete('ticket-products/(:num)/bundles/(:num)', 'Api\TicketsController::bundleDelete/$1/$2');
    $routes->post('seat-holds', 'Api\TicketsController::seatHoldCreate');
    $routes->post('seat-holds/release', 'Api\TicketsController::seatHoldRelease');
    $routes->get('reports/tickets/sales', 'Api\TicketsController::reportsTicketSales');
    $routes->get('reports/tickets/redemptions', 'Api\TicketsController::reportsTicketRedemptions');
    $routes->get('reports/tickets/no-shows', 'Api\TicketsController::reportsTicketNoShows');

    // PUBLIC endpoints — no auth required. Customer-safe data only.
    $routes->get('public/menu/(:segment)', 'Api\PublicController::menu/$1');
    $routes->get('public/giftcards/balance/(:segment)', 'Api\PublicController::giftcardBalance/$1');
    $routes->get('public/giftcards/transfer/(:segment)', 'Api\PublicController::giftcardTransferLookup/$1');
    $routes->post('public/giftcards/transfer/(:segment)/accept', 'Api\PublicController::giftcardTransferAccept/$1');
    // Customer self-service (Phase 6)
    $routes->get('public/giftcards/(:segment)/binding', 'Api\PublicController::giftcardPublicBinding/$1');
    $routes->post('public/giftcards/(:segment)/binding/otp', 'Api\PublicController::giftcardPublicOtp/$1');
    $routes->delete('public/giftcards/(:segment)/binding', 'Api\PublicController::giftcardPublicUnbind/$1');
    $routes->post('public/giftcards/(:segment)/disable', 'Api\PublicController::giftcardPublicDisable/$1');
    // Wallet passes (Phase E redesign — gift cards live alongside tickets)
    $routes->get('public/giftcards/(:segment)/wallet/google', 'Api\PublicController::giftcardGoogleWallet/$1');
    $routes->get('public/giftcards/(:segment)/wallet/apple', 'Api\PublicController::giftcardAppleWallet/$1');
    // My Gifts — OTP-gated roll-up by phone (Slice E.2)
    $routes->post('public/giftcards/by-phone/send-otp', 'Api\PublicController::giftcardListByPhoneSendOtp');
    $routes->post('public/giftcards/by-phone/verify', 'Api\PublicController::giftcardListByPhoneVerify');
    // Sender re-gift — OTP-gated public transfer from /g/:code (Slice E.3)
    $routes->post('public/giftcards/(:segment)/transfer/send-otp', 'Api\PublicController::giftcardTransferSendOtp/$1');
    $routes->post('public/giftcards/(:segment)/transfer/confirm', 'Api\PublicController::giftcardTransferConfirm/$1');
    $routes->get('public/tickets/(:segment)', 'Api\PublicController::ticketLookup/$1');
    $routes->post('public/tickets/(:segment)/transfer/request', 'Api\PublicController::ticketTransferRequest/$1');
    $routes->post('public/tickets/(:segment)/transfer/confirm', 'Api\PublicController::ticketTransferConfirm/$1');
    $routes->get('public/tickets/(:segment)/ics', 'Api\PublicController::ticketIcs/$1');
    $routes->get('public/tickets/(:segment)/google-wallet', 'Api\PublicController::ticketGoogleWallet/$1');
    $routes->get('public/tickets/(:segment)/apple-wallet', 'Api\PublicController::ticketAppleWallet/$1');

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
    $routes->options('giftcards/(:num)/transfers/(:num)', 'Api\GiftcardsController::preflight');
    $routes->options('giftcards/(:num)/payment-intent/(:num)', 'Api\GiftcardsController::preflight');
    $routes->options('giftcards/(:num)/payment-intent/(:num)/cancel', 'Api\GiftcardsController::preflight');
    $routes->options('giftcard-designs', 'Api\GiftcardsController::preflight');
    $routes->options('giftcard-designs/(:num)', 'Api\GiftcardsController::preflight');
    $routes->options('giftcard-denominations', 'Api\GiftcardsController::preflight');
    $routes->options('giftcard-denominations/(:num)', 'Api\GiftcardsController::preflight');
    $routes->options('webhooks/mno/(:segment)', 'Api\GiftcardsController::preflight');
    $routes->options('public/giftcards/balance/(:segment)', 'Api\PublicController::preflight');
    $routes->options('public/giftcards/transfer/(:segment)', 'Api\PublicController::preflight');
    $routes->options('public/giftcards/transfer/(:segment)/accept', 'Api\PublicController::preflight');
    $routes->options('public/giftcards/(:segment)/binding', 'Api\PublicController::preflight');
    $routes->options('public/giftcards/(:segment)/binding/otp', 'Api\PublicController::preflight');
    $routes->options('public/giftcards/(:segment)/disable', 'Api\PublicController::preflight');
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
    $routes->options('ticket-products/(:num)/(:any)', 'Api\TicketsController::preflight');
    $routes->options('ticket-products/(:num)/(:any)/(:any)', 'Api\TicketsController::preflight');
    $routes->options('tickets', 'Api\TicketsController::preflight');
    $routes->options('tickets/(:num)', 'Api\TicketsController::preflight');
    $routes->options('tickets/(:num)/(:any)', 'Api\TicketsController::preflight');
    $routes->options('tickets/redeem', 'Api\TicketsController::preflight');
    $routes->options('public/tickets/(:segment)', 'Api\PublicController::preflight');
    $routes->options('public/tickets/(:segment)/(:any)', 'Api\PublicController::preflight');
    $routes->options('public/tickets/(:segment)/(:any)/(:any)', 'Api\PublicController::preflight');
    $routes->options('ticket-promos', 'Api\TicketsController::preflight');
    $routes->options('ticket-promos/(:any)', 'Api\TicketsController::preflight');
    $routes->options('seat-holds', 'Api\TicketsController::preflight');
    $routes->options('seat-holds/(:any)', 'Api\TicketsController::preflight');
    $routes->options('reports/tickets/(:any)', 'Api\TicketsController::preflight');
});
