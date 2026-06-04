<?= view('partial/header') ?>

<div class="container-fluid">
    <h2><?= lang('Tickets.redeem') ?></h2>
    <p class="text-muted"><?= lang('Tickets.redeem_scan_prompt') ?></p>

    <form id="redeem_form" class="form-inline">
        <div class="form-group">
            <input type="text" name="token" id="redeem_token" class="form-control" placeholder="Token or code" autocomplete="off" autofocus style="width: 480px;">
        </div>
        <button type="submit" class="btn btn-primary"><?= lang('Tickets.redeem') ?></button>
    </form>

    <div id="redeem_result" style="margin-top: 20px;"></div>
</div>

<script type="text/javascript">
$(function() {
    function uuid() {
        return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
            : 'k-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }

    $('#redeem_form').on('submit', function(ev) {
        ev.preventDefault();
        var token = $('#redeem_token').val().trim();
        if (!token) { return; }

        $.ajax({
            url: '<?= esc(site_url("tickets/redeem")) ?>',
            method: 'POST',
            data: { token: token, idempotency_key: uuid() },
            dataType: 'json'
        }).done(function(resp) {
            var cls = resp.success ? 'alert-success' : 'alert-danger';
            $('#redeem_result').html(
                '<div class="alert ' + cls + '">' +
                '<strong>' + (resp.success ? '\u2713' : '\u2717') + '</strong> ' +
                $('<div/>').text(resp.message || resp.result || '').html() +
                '</div>'
            );
            $('#redeem_token').val('').focus();
        }).fail(function(xhr) {
            $('#redeem_result').html(
                '<div class="alert alert-danger">Request failed: ' +
                $('<div/>').text(xhr.statusText || 'unknown').html() + '</div>'
            );
        });
    });
});
</script>

<?= view('partial/footer') ?>
