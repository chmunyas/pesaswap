<?php
/**
 * @var int    $ticket_product_id
 * @var object $info
 * @var array  $subtypes
 * @var array  $code_types
 * @var array  $locations
 * @var string $default_color
 * @var string $controller_name
 */

$subtype = $info->subtype ?? 'meeting';
?>

<div id="required_fields_message"><?= lang('Common.fields_required_message') ?></div>
<ul id="error_message_box" class="error_message_box"></ul>

<?= form_open("tickets/save/$ticket_product_id", ['id' => 'ticket_form', 'class' => 'form-horizontal']) ?>

    <fieldset id="ticket_base_info">
        <legend><?= lang('Tickets.new') ?></legend>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.title'), 'title', ['class' => 'required control-label col-xs-3']) ?>
            <div class="col-xs-8">
                <?= form_input(['name' => 'title', 'id' => 'title', 'class' => 'form-control input-sm required', 'value' => $info->title ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label('Item ID', 'item_id', ['class' => 'required control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <?= form_input(['name' => 'item_id', 'id' => 'item_id', 'type' => 'number', 'min' => 1, 'class' => 'form-control input-sm', 'value' => $info->item_id ?? '']) ?>
                <small class="text-muted">Reference an existing item with item_type = ITEM_TICKET.</small>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.subtype'), 'subtype', ['class' => 'required control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <select name="subtype" id="subtype" class="form-control input-sm">
                    <?php foreach ($subtypes as $st): ?>
                        <option value="<?= esc($st) ?>" <?= $st === $subtype ? 'selected' : '' ?>><?= esc(lang('Tickets.subtype_' . $st)) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.code_type'), 'code_type', ['class' => 'required control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <select name="code_type" id="code_type" class="form-control input-sm">
                    <?php foreach ($code_types as $ct): ?>
                        <option value="<?= esc($ct) ?>" <?= ($info->code_type ?? 'qrcode') === $ct ? 'selected' : '' ?>><?= esc(lang('Tickets.code_type_' . $ct)) ?></option>
                    <?php endforeach; ?>
                </select>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.brand_name'), 'brand_name', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <?= form_input(['name' => 'brand_name', 'class' => 'form-control input-sm', 'value' => $info->brand_name ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.color'), 'color', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <?= form_input(['name' => 'color', 'class' => 'form-control input-sm', 'value' => $info->color ?? $default_color]) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.notice'), 'notice', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-8">
                <?= form_input(['name' => 'notice', 'class' => 'form-control input-sm', 'value' => $info->notice ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.description'), 'description', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-8">
                <?= form_textarea(['name' => 'description', 'class' => 'form-control input-sm', 'rows' => 3, 'value' => $info->description ?? '']) ?>
            </div>
        </div>
    </fieldset>

    <fieldset id="ticket_validity">
        <legend><?= lang('Tickets.validity_mode') ?></legend>

        <div class="form-group form-group-sm">
            <div class="col-xs-offset-3 col-xs-8">
                <label class="radio-inline">
                    <input type="radio" name="validity_mode" value="fixed" <?= ($info->validity_mode ?? 'fixed') === 'fixed' ? 'checked' : '' ?>>
                    <?= lang('Tickets.validity_mode_fixed') ?>
                </label>
                <label class="radio-inline">
                    <input type="radio" name="validity_mode" value="relative" <?= ($info->validity_mode ?? '') === 'relative' ? 'checked' : '' ?>>
                    <?= lang('Tickets.validity_mode_relative') ?>
                </label>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.begin_ts'), 'begin_ts', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <?= form_input(['name' => 'begin_ts', 'type' => 'datetime-local', 'class' => 'form-control input-sm', 'value' => $info->begin_ts ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.end_ts'), 'end_ts', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-4">
                <?= form_input(['name' => 'end_ts', 'type' => 'datetime-local', 'class' => 'form-control input-sm', 'value' => $info->end_ts ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.fixed_begin_term_days'), 'fixed_begin_term_days', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-2">
                <?= form_input(['name' => 'fixed_begin_term_days', 'type' => 'number', 'min' => 0, 'class' => 'form-control input-sm', 'value' => $info->fixed_begin_term_days ?? '']) ?>
            </div>
            <?= form_label(lang('Tickets.fixed_term_days'), 'fixed_term_days', ['class' => 'control-label col-xs-2']) ?>
            <div class="col-xs-2">
                <?= form_input(['name' => 'fixed_term_days', 'type' => 'number', 'min' => 0, 'class' => 'form-control input-sm', 'value' => $info->fixed_term_days ?? '']) ?>
            </div>
        </div>
    </fieldset>

    <fieldset id="ticket_stock">
        <legend><?= lang('Tickets.quantity') ?></legend>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.quantity'), 'quantity', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-3">
                <?= form_input(['name' => 'quantity', 'type' => 'number', 'min' => 0, 'class' => 'form-control input-sm', 'placeholder' => lang('Tickets.quantity_unlimited'), 'value' => $info->quantity ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <?= form_label(lang('Tickets.max_per_customer'), 'max_per_customer', ['class' => 'control-label col-xs-3']) ?>
            <div class="col-xs-3">
                <?= form_input(['name' => 'max_per_customer', 'type' => 'number', 'min' => 0, 'class' => 'form-control input-sm', 'value' => $info->max_per_customer ?? '']) ?>
            </div>
        </div>

        <div class="form-group form-group-sm">
            <div class="col-xs-offset-3 col-xs-8">
                <label class="checkbox-inline"><input type="checkbox" name="bind_customer" value="1" <?= !empty($info->bind_customer) ? 'checked' : '' ?>> <?= lang('Tickets.bind_customer') ?></label>
                <label class="checkbox-inline"><input type="checkbox" name="transferable"  value="1" <?= !empty($info->transferable)  ? 'checked' : '' ?>> <?= lang('Tickets.transferable') ?></label>
                <label class="checkbox-inline"><input type="checkbox" name="single_use"    value="1" <?= !empty($info->single_use)    ? 'checked' : '' ?>> <?= lang('Tickets.single_use') ?></label>
                <label class="checkbox-inline"><input type="checkbox" name="refundable"    value="1" <?= !empty($info->refundable)    ? 'checked' : '' ?>> <?= lang('Tickets.refundable') ?></label>
            </div>
        </div>
    </fieldset>

    <fieldset id="ticket_subtype_fields">
        <div data-subtype-meeting style="display: <?= $subtype === 'meeting' ? 'block' : 'none' ?>">
            <legend><?= lang('Tickets.subtype_meeting') ?></legend>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.meeting_detail'), 'meeting_detail', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8"><?= form_textarea(['name' => 'meeting_detail', 'rows' => 3, 'class' => 'form-control input-sm', 'value' => $info->meeting_detail ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.map_url'), 'map_url', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8"><?= form_input(['name' => 'map_url', 'class' => 'form-control input-sm', 'value' => $info->map_url ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.entrance'), 'entrance', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-4"><?= form_input(['name' => 'entrance', 'class' => 'form-control input-sm', 'value' => $info->entrance ?? '']) ?></div>
                <?= form_label(lang('Tickets.zone'), 'zone', ['class' => 'control-label col-xs-2']) ?>
                <div class="col-xs-2"><?= form_input(['name' => 'zone', 'class' => 'form-control input-sm', 'value' => $info->zone ?? '']) ?></div>
            </div>
        </div>

        <div data-subtype-scenic style="display: <?= $subtype === 'scenic' ? 'block' : 'none' ?>">
            <legend><?= lang('Tickets.subtype_scenic') ?></legend>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.scenic_name'), 'scenic_name', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8"><?= form_input(['name' => 'scenic_name', 'class' => 'form-control input-sm', 'value' => $info->scenic_name ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.opening_hours'), 'opening_hours', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-4"><?= form_input(['name' => 'opening_hours', 'class' => 'form-control input-sm', 'value' => $info->opening_hours ?? '']) ?></div>
                <?= form_label(lang('Tickets.ticket_class'), 'ticket_class', ['class' => 'control-label col-xs-2']) ?>
                <div class="col-xs-2"><?= form_input(['name' => 'ticket_class', 'class' => 'form-control input-sm', 'value' => $info->ticket_class ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.address'), 'address', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8"><?= form_input(['name' => 'address', 'class' => 'form-control input-sm', 'value' => $info->address ?? '']) ?></div>
            </div>
        </div>

        <div data-subtype-movie style="display: <?= $subtype === 'movie' ? 'block' : 'none' ?>">
            <legend><?= lang('Tickets.subtype_movie') ?></legend>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.film_title'), 'film_title', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8"><?= form_input(['name' => 'film_title', 'class' => 'form-control input-sm', 'value' => $info->film_title ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.hall'), 'hall', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'hall', 'class' => 'form-control input-sm', 'value' => $info->hall ?? '']) ?></div>
                <?= form_label(lang('Tickets.screening_ts'), 'screening_ts', ['class' => 'control-label col-xs-2']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'screening_ts', 'type' => 'datetime-local', 'class' => 'form-control input-sm', 'value' => $info->screening_ts ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.seat_map'), 'seat_map_json', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8">
                    <?= form_textarea(['name' => 'seat_map_json', 'rows' => 4, 'class' => 'form-control input-sm', 'placeholder' => '{"rows":10,"cols":12,"sold":[]}', 'value' => $info->seat_map_json ?? '']) ?>
                    <small class="text-muted">JSON seat-map. Visual editor lands in Phase 2.</small>
                </div>
            </div>
        </div>

        <div data-subtype-transport style="display: <?= $subtype === 'transport' ? 'block' : 'none' ?>">
            <legend><?= lang('Tickets.subtype_transport') ?></legend>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.origin'), 'origin', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'origin', 'class' => 'form-control input-sm', 'value' => $info->origin ?? '']) ?></div>
                <?= form_label(lang('Tickets.destination'), 'destination', ['class' => 'control-label col-xs-2']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'destination', 'class' => 'form-control input-sm', 'value' => $info->destination ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.carrier'), 'carrier', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'carrier', 'class' => 'form-control input-sm', 'value' => $info->carrier ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.departure_ts'), 'departure_ts', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'departure_ts', 'type' => 'datetime-local', 'class' => 'form-control input-sm', 'value' => $info->departure_ts ?? '']) ?></div>
                <?= form_label(lang('Tickets.arrival_ts'), 'arrival_ts', ['class' => 'control-label col-xs-2']) ?>
                <div class="col-xs-3"><?= form_input(['name' => 'arrival_ts', 'type' => 'datetime-local', 'class' => 'form-control input-sm', 'value' => $info->arrival_ts ?? '']) ?></div>
            </div>
            <div class="form-group form-group-sm">
                <?= form_label(lang('Tickets.seat_map'), 'seat_map_json', ['class' => 'control-label col-xs-3']) ?>
                <div class="col-xs-8">
                    <?= form_textarea(['name' => 'seat_map_json', 'rows' => 4, 'class' => 'form-control input-sm', 'value' => $info->seat_map_json ?? '']) ?>
                </div>
            </div>
        </div>
    </fieldset>

    <fieldset id="ticket_locations">
        <legend><?= lang('Tickets.locations') ?></legend>
        <div class="form-group form-group-sm">
            <div class="col-xs-offset-3 col-xs-8">
                <?php foreach ($locations as $loc): ?>
                    <label class="checkbox-inline">
                        <input type="checkbox" name="location_ids[]" value="<?= esc($loc->location_id) ?>" <?= in_array((int) $loc->location_id, $info->location_ids ?? [], true) ? 'checked' : '' ?>>
                        <?= esc($loc->location_name) ?>
                    </label>
                <?php endforeach; ?>
            </div>
        </div>
    </fieldset>

<?= form_close() ?>

<script type="text/javascript">
$(function() {
    function showSubtypeFor(value) {
        $('[data-subtype-meeting], [data-subtype-scenic], [data-subtype-movie], [data-subtype-transport]').hide();
        $('[data-subtype-' + value + ']').show();
    }
    $('#subtype').on('change', function() { showSubtypeFor($(this).val()); });

    $('#ticket_form').validate($.extend({
        submitHandler: function(form) {
            $(form).ajaxSubmit({
                success: function(response) {
                    dialog_support.hide();
                    table_support.handle_submit("<?= esc($controller_name) ?>", response);
                },
                error: function(jqXHR, _ts, errorThrown) {
                    table_support.handle_submit("<?= esc($controller_name) ?>", { message: errorThrown });
                },
                dataType: 'json'
            });
        },
        errorLabelContainer: '#error_message_box',
        rules: {
            title:   { required: true },
            item_id: { required: true, number: true }
        }
    }, form_support.error));
});
</script>
