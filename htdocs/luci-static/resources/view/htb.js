'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require rpc';
'require fs';

// Helper function to add relevance info to descriptions
function addRelevanceInfo(description, rootQdisc) {
    var note = '';
    
    // Check ROOT_QDISC relevance
    if (rootQdisc !== 'htb') {
        note = ' ⚠ Not used with ' + rootQdisc.toUpperCase();
    } else {
        note = ' ✓ Active for ' + rootQdisc.toUpperCase();
    }
    
    return description + note;
}

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

return view.extend({
    handleSaveApply: function(ev) {
        return this.handleSave(ev)
            .then(() => ui.changes.apply())
            .then(() => uci.load('qosmate'))
            .then(() => uci.get_first('qosmate', 'global', 'enabled'))
            .then(enabled => {
                if (enabled === '0') {
                    return fs.exec_direct('/etc/init.d/qosmate', ['stop']);
                } else {
                    return fs.exec_direct('/etc/init.d/qosmate', ['restart']);
                }
            })
            .then(() => {
                ui.hideModal();
                window.location.reload();
            })
            .catch(err => {
                ui.hideModal();
                ui.addNotification(null, E('p', _('Failed to save settings or update QoSmate service: ') + err.message));
            });
    },

    render: function() {
        return Promise.all([
            uci.load('qosmate')
        ]).then(() => {
            var m, s, o;
            var rootQdisc = uci.get('qosmate', 'settings', 'ROOT_QDISC') || 'hfsc';
            var htbQdisc = uci.get('qosmate', 'htb', 'htbqdisc') || 'fq_codel';

            var relevanceText = '';
            if (rootQdisc === 'hfsc') {
                relevanceText = _('HTB mode active.');
            } else {
                relevanceText = _('Current Root QDisc is %s - HTB settings are not used.').format(rootQdisc.toUpperCase());
            }

            m = new form.Map('qosmate', _('QoSmate HTB Settings (Experimental)'), _('Configure HTB qdisc for QoSmate.') + ' ' + relevanceText);

            s = m.section(form.NamedSection, 'htb', 'htb', _('HTB Settings'));
            s.anonymous = true;

        o = s.option(form.ListValue, 'htbqdisc', _('HTB Internal Queue Discipline'), 
            addRelevanceInfo(_('Queueing method for 3 htb traffic classes, configured with slightly different params.'), rootQdisc));
        o.value('fq_codel', _('FQ_CODEL'));
        o.value('fq_pie', _('FQ_PIE'));
        o.default = 'fq_codel';

        return m.render();
        });
    }
});
