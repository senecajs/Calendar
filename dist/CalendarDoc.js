"use strict";
/* Copyright © 2024–2026 Seneca Project Contributors, MIT License. */
Object.defineProperty(exports, "__esModule", { value: true });
const docs = {
    messages: {
        msgAddEvent: {
            desc: 'Add a calendar event by key (fails if key exists unless existing:true; key must match [A-Za-z0-9._:-]+).',
        },
        msgGetEvent: {
            desc: 'Get a calendar event by key.',
        },
        msgListEvent: {
            desc: 'List calendar events by query.',
        },
        msgUpdateEvent: {
            desc: 'Update fields on an existing calendar event (validates before assign).',
        },
        msgRemoveEvent: {
            desc: 'Remove a calendar event by key.',
        },
        msgDueEvents: {
            desc: 'List active (non-snoozed) events whose remind window has been reached.',
        },
        msgAckEvent: {
            desc: 'Acknowledge an event (default status acknowledged; done:true for done). Recurring events roll due and reset notify stages.',
        },
        msgSnoozeEvent: {
            desc: 'Snooze an event until a timestamp; resets notify stages.',
        },
        msgNotifyDue: {
            desc: 'Emit newly-crossed reminder stages via hook:notify and/or notifyCallback. Stages marked only on successful delivery. digest:true groups into one payload.',
        },
        msgExportIcs: {
            desc: 'Export events as a VCALENDAR/ICS string (optional q filter).',
        },
        msgListNotifications: {
            desc: 'List notification outbox records (when record:true).',
        },
        msgRefreshEvent: {
            desc: 'Refresh one event due date via app-registered sys:calendar,hook:source.',
        },
        msgRefreshEvents: {
            desc: 'Refresh many events via hook:source (optional q filter).',
        },
    },
};
exports.default = docs;
if ('undefined' !== typeof module) {
    module.exports = docs;
}
//# sourceMappingURL=CalendarDoc.js.map