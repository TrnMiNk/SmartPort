const crypto = require('node:crypto');
const fs = require('node:fs');

function validImo(imo) {
    return typeof imo === 'string' && /^[1-9][0-9]{6}$/.test(imo) &&
        [...imo.slice(0, 6)].reduce((sum, digit, i) => sum + Number(digit) * (7 - i), 0) % 10 === Number(imo[6]);
}

const text = value => typeof value === 'string' && value.trim().length > 0;
const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

// No default list of mandatory documents or implicit empty blacklist.
function parsePolicy(raw) {
    if (raw?.mode !== 'DEMO' || !text(raw.policyId) || raw.policyId.length > 100 ||
        !instant(raw.reviewedAt) || !instant(raw.validUntil) || Date.parse(raw.reviewedAt) >= Date.parse(raw.validUntil) ||
        !raw.requiredDocumentTypesByShipType || Array.isArray(raw.requiredDocumentTypesByShipType) ||
        typeof raw.requiredDocumentTypesByShipType !== 'object' || !Array.isArray(raw.restrictedImos)) {
        throw new Error('Invalid UC015 demo policy');
    }
    const rules = Object.entries(raw.requiredDocumentTypesByShipType);
    if (!rules.length || rules.some(([shipType, types]) => !text(shipType) || shipType !== shipType.trim() ||
        !Array.isArray(types) || !types.length || types.some(type => !text(type) || type.length > 50 || type !== type.trim()) ||
        new Set(types).size !== types.length)) throw new Error('Invalid UC015 document rules');
    if (raw.restrictedImos.some(row => !validImo(row.imo) || !text(row.reason) || row.reason.length > 500))
        throw new Error('Invalid UC015 restrictions');
    const policy = JSON.parse(JSON.stringify(raw));
    policy.hash = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    return policy;
}

function loadPolicy(filename) {
    return filename ? parsePolicy(JSON.parse(fs.readFileSync(filename, 'utf8'))) : null;
}

function checkPolicy(policy, now) {
    if (!policy || Date.parse(policy.reviewedAt) > now.getTime() || Date.parse(policy.validUntil) <= now.getTime()) {
        const error = new Error('UC015 policy is missing, not effective, or expired');
        error.status = 503; error.code = 'VALIDATION_POLICY_UNAVAILABLE';
        throw error;
    }
}

function evaluate(row, documents, policy, now, effectiveEta) {
    if (!row.ship_exists || !row.is_active) return { result: 'REJECTED', reason: 'VESSEL_INACTIVE_OR_MISSING' };
    if (!validImo(row.imo_number)) return { result: 'REJECTED', reason: 'INVALID_IMO' };
    const restriction = policy.restrictedImos.find(entry => entry.imo === row.imo_number);
    if (restriction) return { result: 'REJECTED', reason: `VESSEL_RESTRICTED: ${restriction.reason}` };
    const requiredStrings = ['voyage_code', 'cargo_type', 'ship_code', 'ship_name', 'ship_type'];
    if (requiredStrings.some(field => !text(row[field])) ||
        !Number.isInteger(row.agent_id) || row.agent_id <= 0 || !Number.isInteger(row.origin_port_id) || row.origin_port_id <= 0 ||
        !Number.isInteger(row.declared_teu) || row.declared_teu < 0 ||
        (row.priority_level != null && (!Number.isInteger(row.priority_level) || row.priority_level < 0)) ||
        !row.declared_eta || !Number.isFinite(new Date(row.declared_eta).getTime()) ||
        ['capacity', 'length_overall', 'draft'].some(field => !Number.isFinite(Number(row[field])) || Number(row[field]) <= 0)) {
        return { result: 'REJECTED', reason: 'REQUIRED_DATA_INVALID' };
    }
    const types = Object.hasOwn(policy.requiredDocumentTypesByShipType, row.ship_type)
        ? policy.requiredDocumentTypesByShipType[row.ship_type] : null;
    if (!types) return { result: 'MISSING_DOCUMENTS', reason: 'DOCUMENT_POLICY_NOT_DEFINED_FOR_SHIP_TYPE' };
    const through = Math.max(now.getTime(), new Date(effectiveEta).getTime());
    const missing = types.filter(type => !documents.some(doc => {
        const from = doc.valid_from == null ? NaN : new Date(doc.valid_from).getTime();
        const until = doc.valid_until == null ? NaN : new Date(doc.valid_until).getTime();
        return doc.document_type === type && doc.review_status === 'APPROVED' &&
            Number.isFinite(from) && Number.isFinite(until) && from <= now.getTime() && until >= through && from < until;
    }));
    return missing.length ? { result: 'MISSING_DOCUMENTS', reason: `DOCUMENTS_NOT_ELIGIBLE: ${missing.join(', ')}`.slice(0, 1000) }
        : { result: 'VALID', reason: null };
}

module.exports = { parsePolicy, loadPolicy, checkPolicy, evaluate, validImo };
