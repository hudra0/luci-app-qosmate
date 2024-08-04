'use strict';
'require view';
'require form';
'require ui';
'require uci';
'require rpc';
'require fs';
'require poll';

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

var currentVersion = 'Unknown';
var latestVersion = 'Unknown';

function fetchCurrentVersion() {
    return fs.read('/etc/qosmate.sh').then(function(content) {
        var match = content.match(/^VERSION="(.+)"/m);
        currentVersion = match ? match[1] : 'Unknown';
        return currentVersion;
    }).catch(function(error) {
        console.error('Error reading current version:', error);
        return 'Unknown';
    });
}

function fetchLatestVersion() {
    return new Promise((resolve, reject) => {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://raw.githubusercontent.com/hudra0/qosmate/main/etc/qosmate.sh', true);
        xhr.onload = function() {
            if (xhr.status === 200) {
                var match = xhr.responseText.match(/^VERSION="(.+)"/m);
                latestVersion = match ? match[1] : 'Unknown';
                resolve(latestVersion);
            } else {
                reject('Failed to fetch latest version');
            }
        };
        xhr.onerror = function() {
            reject('Network error');
        };
        xhr.send();
    });
}

return view.extend({
    handleSaveApply: function(ev) {
        return this.handleSave(ev)
            .then(() => {
                return ui.changes.apply();
            })
            .then(() => {
                return uci.load('qosmate');
            })
            .then(() => {
                return uci.get_first('qosmate', 'global', 'enabled');
            })
            .then(enabled => {
                if (enabled === '0') {
                    return callInitAction('qosmate', 'stop');
                } else {
                    return uci.changes().then(changes => {
                        if (Object.keys(changes).length > 0) {
                            return callInitAction('qosmate', 'restart');
                        }
                        return Promise.resolve();
                    });
                }
            })
            .then(() => {
                ui.hideModal();
                window.location.reload();
            })
            .catch((err) => {
                ui.hideModal();
                ui.addNotification(null, E('p', _('Failed to save settings or update QoSmate service: ') + err.message));
            });
    },

    load: function() {
        return Promise.all([
            uci.load('qosmate'),
            fetchCurrentVersion(),
            fetchLatestVersion()
        ]);
    },

    render: function() {
        var m, s, o;

        m = new form.Map('qosmate', _('QoSmate Settings'), _('Configure QoSmate settings.'));

        s = m.section(form.NamedSection, 'global', 'global', _('Global Settings'));
        s.anonymous = true;

        o = s.option(form.DummyValue, '_status', _('Service Status'));
        o.rawhtml = true;
        o.render = function(section_id) {
            var status = uci.get('qosmate', 'global', 'enabled') === '1' ? 'Running' : 'Stopped (Disabled)';
            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Service Status')),
                E('div', { 'class': 'cbi-value-field' }, status)
            ]);
        };
        
        o = s.option(form.DummyValue, '_buttons', _('Service Control'));
        o.rawhtml = true;
        o.render = function(section_id) {
            var buttonStyle = 'button cbi-button';
            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Service Control')),
                E('div', { 'class': 'cbi-value-field' }, [
                    E('button', {
                        'class': buttonStyle + ' cbi-button-apply',
                        'click': ui.createHandlerFn(this, function() {
                            return fs.exec_direct('/etc/init.d/qosmate', ['start'])
                                .then(function() { ui.addNotification(null, E('p', _('QoSmate started')), 'success'); })
                                .catch(function(e) { ui.addNotification(null, E('p', _('Failed to start QoSmate: ') + e), 'error'); });
                        })
                    }, _('Start')),
                    ' ',
                    E('button', {
                        'class': buttonStyle + ' cbi-button-neutral',
                        'click': ui.createHandlerFn(this, function() {
                            return fs.exec_direct('/etc/init.d/qosmate', ['restart'])
                                .then(function() { ui.addNotification(null, E('p', _('QoSmate restarted')), 'success'); })
                                .catch(function(e) { ui.addNotification(null, E('p', _('Failed to restart QoSmate: ') + e), 'error'); });
                        })
                    }, _('Restart')),
                    ' ',
                    E('button', {
                        'class': buttonStyle + ' cbi-button-reset',
                        'click': ui.createHandlerFn(this, function() {
                            return fs.exec_direct('/etc/init.d/qosmate', ['stop'])
                                .then(function() { ui.addNotification(null, E('p', _('QoSmate stopped')), 'success'); })
                                .catch(function(e) { ui.addNotification(null, E('p', _('Failed to stop QoSmate: ') + e), 'error'); });
                        })
                    }, _('Stop'))
                ])
            ]);
        };

        // Auto Setup Button
        o = s.option(form.Button, '_auto_setup', _('Auto Setup'));
        o.inputstyle = 'apply';
        o.inputtitle = _('Start Auto Setup');
        o.onclick = ui.createHandlerFn(this, function() {
            ui.showModal(_('Auto Setup'), [
                E('p', _('This will run a speed test and configure QoSmate automatically.')),
                E('div', { 'class': 'cbi-value' }, [
                    E('label', { 'class': 'cbi-value-title' }, _('Gaming Device IP (optional)')),
                    E('input', { 'id': 'gaming_ip', 'type': 'text', 'class': 'cbi-input-text' })
                ]),
                E('div', { 'class': 'right' }, [
                    E('button', {
                        'class': 'btn',
                        'click': ui.hideModal
                    }, _('Cancel')),
                    ' ',
                    E('button', {
                        'class': 'btn cbi-button-action',
                        'click': ui.createHandlerFn(this, function() {
                            var gamingIp = document.getElementById('gaming_ip').value;
                            ui.showModal(_('Running Auto Setup'), [
                                E('p', { 'class': 'spinning' }, _('Please wait while the auto setup is in progress...'))
                            ]);
                            return fs.exec_direct('/etc/init.d/qosmate', ['auto_setup_noninteractive', gamingIp])
                                .then(function(res) {
                                    var outputFile = res.trim();
                                    return fs.read(outputFile).then(function(output) {
                                        ui.hideModal();
                                        
                                        // Extrahiere relevante Informationen
                                        var wanInterface = output.match(/Detected WAN interface: (.+)/);
                                        var downloadSpeed = output.match(/Download speed: (.+) Mbit\/s/);
                                        var uploadSpeed = output.match(/Upload speed: (.+) Mbit\/s/);
                                        var downrate = output.match(/DOWNRATE: (.+) kbps/);
                                        var uprate = output.match(/UPRATE: (.+) kbps/);
                                        var gamingRules = output.match(/Gaming device rules added for IP: (.+)/);
        
                                        ui.showModal(_('Auto Setup Results'), [
                                            E('h4', _('Speed Test Results')),
                                            E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('WAN Interface')),
                                                E('div', { 'class': 'cbi-value-field' }, wanInterface ? wanInterface[1] : _('Not detected'))
                                            ]),
                                            E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('Download Speed')),
                                                E('div', { 'class': 'cbi-value-field' }, downloadSpeed ? downloadSpeed[1] + ' Mbit/s' : _('Not available'))
                                            ]),
                                            E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('Upload Speed')),
                                                E('div', { 'class': 'cbi-value-field' }, uploadSpeed ? uploadSpeed[1] + ' Mbit/s' : _('Not available'))
                                            ]),
                                            E('h4', _('QoS Configuration')),
                                            E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('Download Rate')),
                                                E('div', { 'class': 'cbi-value-field' }, downrate ? downrate[1] + ' kbps' : _('Not set'))
                                            ]),
                                            E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('Upload Rate')),
                                                E('div', { 'class': 'cbi-value-field' }, uprate ? uprate[1] + ' kbps' : _('Not set'))
                                            ]),
                                            gamingRules ? E('div', { 'class': 'cbi-value' }, [
                                                E('label', { 'class': 'cbi-value-title' }, _('Gaming Rules')),
                                                E('div', { 'class': 'cbi-value-field' }, _('Added for IP: ') + gamingRules[1])
                                            ]) : '',
                                            E('div', { 'class': 'right' }, [
                                                E('button', {
                                                    'class': 'btn cbi-button-action',
                                                    'click': ui.createHandlerFn(this, function() {
                                                        ui.hideModal();
                                                        location.reload();
                                                    })
                                                }, _('Apply and Reload'))
                                            ])
                                        ]);
                                    });
                                })
                                .catch(function(err) {
                                    ui.hideModal();
                                    ui.addNotification(null, E('p', _('Auto setup failed: ') + err), 'error');
                                });
                        })
                    }, _('Start'))
                ])
            ]);
        });

        o = s.option(form.Flag, 'enabled', _('Enable'), _('Enable or disable qosmate'));
        o.rmempty = false;

        // Version information
        o = s.option(form.DummyValue, '_version', _('Version Information'));
        o.rawhtml = true;
        o.render = function(section_id) {
            var updateAvailable = currentVersion !== latestVersion && currentVersion !== 'Unknown' && latestVersion !== 'Unknown';

            var html = '<div>' +
                    '<strong>' + _('Current Version') + ':</strong> ' + currentVersion + '<br>' +
                    '<strong>' + _('Latest Version') + ':</strong> ' + latestVersion + '<br>';

            if (updateAvailable) {
                html += '<br><span style="color: red;">' + _('A new version is available!') + '</span><br>';
            } else if (currentVersion !== 'Unknown' && latestVersion !== 'Unknown') {
                html += '<br><span style="color: green;">' + _('QoSmate is up to date.') + '</span>';
            } else {
                html += '<br><span style="color: orange;">' + _('Unable to check for updates.') + '</span>';
            }

            html += '</div>';

            return E('div', { 'class': 'cbi-value' }, [
                E('label', { 'class': 'cbi-value-title' }, _('Version Information')),
                E('div', { 'class': 'cbi-value-field' }, html)
            ]);
        };

        s = m.section(form.NamedSection, 'settings', 'settings', _('Basic Settings'));
        s.anonymous = true;

        function createOption(name, title, description, placeholder, datatype) {
            var opt = s.option(form.Value, name, title, description);
            opt.datatype = datatype || 'string';
            opt.rmempty = true;
            opt.placeholder = placeholder;
            
            if (datatype === 'uinteger') {
                opt.validate = function(section_id, value) {
                    if (value === '' || value === null) return true;
                    if (!/^\d+$/.test(value)) return _('Must be a non-negative integer or empty');
                    return true;
                };
            }
            return opt;
        }

        createOption('WAN', _('WAN Interface'), _('Select the WAN interface'), _('Default: eth1'));
        createOption('DOWNRATE', _('Download Rate (kbps)'), _('Set the download rate in kbps'), _('Default: 90000'), 'uinteger');
        createOption('UPRATE', _('Upload Rate (kbps)'), _('Set the upload rate in kbps'), _('Default: 45000'), 'uinteger');

        o = s.option(form.ListValue, 'ROOT_QDISC', _('Root Queueing Discipline'), _('Select the root queueing discipline'));
        o.value('hfsc', _('HFSC'));
        o.value('cake', _('CAKE'));
        o.default = 'hfsc';

        return m.render();
    }
});

// Poll for current and latest version every 30 seconds
poll.add(function() {
    return Promise.all([
        fetchCurrentVersion(),
        fetchLatestVersion()
    ]);
}, 30);

function updateQosmate() {
    // Implement the update logic here
    ui.showModal(_('Updating QoSmate'), [
        E('p', { 'class': 'spinning' }, _('Updating QoSmate. Please wait...'))
    ]);

    // Simulating an update process
    setTimeout(function() {
        ui.hideModal();
        window.location.reload();
    }, 5000);
}
