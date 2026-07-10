const FAILURE_REASONS = [
	'Product not found',
	'Warehouse not found',
	'Organization not found',
	'Counterparty not found',
	'Contract not found',
	'Project not found',
	'Attribute not found',
	'Validation Error',
	'API Error',
	'Unknown Error',
]

const diagnostics = {
	oldShipments: 0,
	shipments: [],
	current: null,
}

function isObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getValue(source, fields) {
	for (const field of fields) {
		if (source?.[field] !== undefined && source?.[field] !== null && source[field] !== '') {
			return source[field]
		}
	}

	return ''
}

function getReferenceId(reference) {
	return (
		reference?.id ||
		reference?.meta?.href?.split('/').filter(Boolean).at(-1) ||
		reference?.href?.split('/').filter(Boolean).at(-1) ||
		''
	)
}

function getReferenceName(reference) {
	return getValue(reference, ['name', 'number', 'code', 'article', 'externalCode'])
}

function getEntityTypeFromReason(reason) {
	return String(reason || '').replace(/ not found$/i, '')
}

function normalizeReason(reason) {
	if (FAILURE_REASONS.includes(reason)) {
		return reason
	}

	if (reason === 'API Validation Error') {
		return 'Validation Error'
	}

	return 'Unknown Error'
}

function getResponseBody(error) {
	return error?.responseBody || error?.response?.data || error?.data || error?.body || null
}

function getHttpStatus(error) {
	return error?.status || error?.response?.status || null
}

function getCurrentRecord() {
	return diagnostics.current
}

function addException(record, label, error) {
	if (!record) {
		return
	}

	record.exceptions.push({
		label,
		message: error?.message || 'Unknown error',
		stack: error?.stack || '',
		httpStatus: getHttpStatus(error),
		apiResponseBody: getResponseBody(error),
		axiosError: error?.axiosError || null,
	})
}

function formatJson(value) {
	if (value === undefined || value === null || value === '') {
		return ''
	}

	return isObject(value) || Array.isArray(value)
		? JSON.stringify(value, null, 2)
		: String(value)
}

function formatCountLine(label, count) {
	return `${label.padEnd(28, '.')} ${count}`
}

function printMissingEntity(entity) {
	const type = entity.type || 'Entity'
	if (type === 'Product') {
		console.log(`Product Name: ${entity.name || ''}`)
		console.log(`Product Old ID: ${entity.oldId || ''}`)
		return
	}

	console.log(`${type}:`)
	console.log(entity.name || entity.oldId || '')
	if (entity.oldId) {
		console.log(`${type} Old ID: ${entity.oldId}`)
	}
}

export function resetDiagnostics() {
	diagnostics.oldShipments = 0
	diagnostics.shipments = []
	diagnostics.current = null
}

export function setOldShipmentCount(count) {
	diagnostics.oldShipments = count
}

export function getShipmentNumber(shipment) {
	return getValue(shipment, ['name', 'number', 'code', 'id']) || 'Unknown'
}

export function startShipmentDiagnostics(shipment, fallbackId = '') {
	const existingId = shipment?.id || fallbackId || ''
	if (diagnostics.current?.oldShipmentId && diagnostics.current.oldShipmentId === existingId) {
		return diagnostics.current
	}

	const record = {
		shipmentNumber: getShipmentNumber(shipment),
		shipmentName: shipment?.name || '',
		oldShipmentId: shipment?.id || fallbackId || '',
		success: false,
		failed: false,
		created: false,
		skipped: false,
		failureReason: '',
		exceptionMessage: '',
		httpStatus: null,
		apiResponseBody: null,
		axiosError: null,
		finalPayload: null,
		missingEntities: [],
		steps: [],
		exceptions: [],
	}

	diagnostics.shipments.push(record)
	diagnostics.current = record
	return record
}

export function finishShipmentSuccess(result = {}) {
	const record = getCurrentRecord()
	if (!record) {
		return
	}

	record.success = true
	record.failed = false
	record.created = Boolean(result.created)
	record.skipped = Boolean(result.skipped)
	diagnostics.current = null
}

export function finishShipmentFailure(error) {
	recordError(error)
	diagnostics.current = null
}

export function printShipmentHeader() {}

export function logOk(message) {
	const record = getCurrentRecord()
	if (record) {
		record.steps.push({ status: 'OK', message })
	}
}

export function logFailed(reason, details = {}) {
	const record = getCurrentRecord()
	if (!record) {
		return
	}

	record.missingEntities.push({
		type: details.type || getEntityTypeFromReason(reason),
		reason: normalizeReason(reason),
		oldId: details.oldId || '',
		name: details.name || '',
		message: details.message || '',
	})
}

export function logIgnoredError(label, error) {
	addException(getCurrentRecord(), label, error)
}

export function getReferenceDiagnostics(reference) {
	return {
		oldId: getReferenceId(reference),
		name: getReferenceName(reference),
	}
}

export function createDiagnosticError(message, reason, source) {
	const error = new Error(message)
	error.diagnosticReason = normalizeReason(reason)
	error.diagnosticSource = source
	error.diagnosticRecorded = true
	return error
}

export function annotateDiagnosticError(error, reason, source) {
	error.diagnosticReason = normalizeReason(reason)
	error.diagnosticSource = source
	error.diagnosticRecorded = true
	return error
}

export function classifyError(error) {
	if (error?.diagnosticReason) {
		return normalizeReason(error.diagnosticReason)
	}

	const status = getHttpStatus(error)
	if (status === 400) {
		return 'Validation Error'
	}
	if (status && status >= 400) {
		return 'API Error'
	}

	const message = String(error?.message || '')
	if (/organization/i.test(message)) {
		return 'Organization not found'
	}
	if (/warehouse|store/i.test(message)) {
		return 'Warehouse not found'
	}
	if (/counterparty|agent/i.test(message)) {
		return 'Counterparty not found'
	}
	if (/product|assortment/i.test(message)) {
		return 'Product not found'
	}
	if (/contract/i.test(message)) {
		return 'Contract not found'
	}
	if (/project/i.test(message)) {
		return 'Project not found'
	}
	if (/attribute/i.test(message)) {
		return 'Attribute not found'
	}
	if (/validation|required|invalid/i.test(message)) {
		return 'Validation Error'
	}

	return 'Unknown Error'
}

export function recordError(error) {
	const record = getCurrentRecord()
	const reason = classifyError(error)

	if (record) {
		record.failed = true
		record.success = false
		record.failureReason = reason
		record.exceptionMessage = error?.message || 'Unknown error'
		record.httpStatus = getHttpStatus(error)
		record.apiResponseBody = getResponseBody(error)
		record.axiosError = error?.axiosError || null
		addException(record, 'Thrown exception', error)

		if (error?.diagnosticSource) {
			const details = getReferenceDiagnostics(error.diagnosticSource)
			record.missingEntities.push({
				type: getEntityTypeFromReason(reason),
				reason,
				oldId: details.oldId,
				name: details.name,
				message: error?.message || '',
			})
		}
	}

	return reason
}

export function printFinalPayload(payload) {
	const record = getCurrentRecord()
	if (record) {
		record.finalPayload = payload
	}
}

export function printApiError(error) {
	const record = getCurrentRecord()
	if (!record) {
		return
	}

	record.httpStatus = getHttpStatus(error)
	record.apiResponseBody = getResponseBody(error)
	record.axiosError = error?.axiosError || null
	addException(record, 'API create error', error)
}

export function printFinalMigrationReport({ oldShipments, created, failed } = {}) {
	const failedShipments = diagnostics.shipments.filter(shipment => shipment.failed)
	const createdShipments = diagnostics.shipments.filter(shipment => shipment.created)
	const summary = new Map(FAILURE_REASONS.map(reason => [reason, 0]))

	for (const shipment of failedShipments) {
		const reason = normalizeReason(shipment.failureReason)
		summary.set(reason, (summary.get(reason) || 0) + 1)
	}

	console.log('==========================================================')
	console.log('MOYSKLAD SHIPMENT MIGRATION FINAL REPORT')
	console.log('==========================================================')
	console.log('')
	console.log(`Old shipments: ${oldShipments ?? diagnostics.oldShipments}`)
	console.log(`Created: ${created ?? createdShipments.length}`)
	console.log(`Failed: ${failed ?? failedShipments.length}`)
	console.log('')
	console.log('Failure summary:')
	console.log('')

	for (const reason of FAILURE_REASONS) {
		console.log(formatCountLine(reason, summary.get(reason) || 0))
	}

	console.log('')
	console.log('==========================================================')
	console.log('FAILED SHIPMENTS')
	console.log('==========================================================')
	console.log('')

	for (const shipment of failedShipments) {
		console.log(`Shipment: ${shipment.shipmentNumber}`)
		console.log(`Old ID: ${shipment.oldShipmentId}`)
		console.log(`Reason: ${shipment.failureReason || 'Unknown Error'}`)
		if (shipment.exceptionMessage) {
			console.log(`Exception: ${shipment.exceptionMessage}`)
		}
		if (shipment.httpStatus) {
			console.log('')
			console.log(`HTTP Status: ${shipment.httpStatus}`)
		}
		if (shipment.apiResponseBody) {
			console.log('')
			console.log('API Response:')
			console.log(formatJson(shipment.apiResponseBody))
		}
		if (shipment.missingEntities.length) {
			console.log('')
			console.log('Details:')
			for (const entity of shipment.missingEntities) {
				printMissingEntity(entity)
			}
		}
		if (shipment.exceptions.length) {
			console.log('')
			console.log('Exceptions:')
			for (const exception of shipment.exceptions) {
				console.log(`${exception.label}: ${exception.message}`)
				if (exception.httpStatus) {
					console.log(`HTTP Status: ${exception.httpStatus}`)
				}
				if (exception.apiResponseBody) {
					console.log('API Response:')
					console.log(formatJson(exception.apiResponseBody))
				}
				if (exception.axiosError) {
					console.log('Axios Error:')
					console.log(formatJson(exception.axiosError))
				}
				if (exception.stack) {
					console.log('Stack:')
					console.log(exception.stack)
				}
			}
		}
		console.log('')
		console.log('----------------------------------------------------------')
		console.log('')
	}

	console.log('==========================================================')
	console.log('SUCCESSFULLY CREATED SHIPMENTS')
	console.log('==========================================================')
	console.log('')

	for (const shipment of createdShipments) {
		console.log(shipment.shipmentNumber)
	}

	console.log('')
	console.log('==========================================================')
	console.log('END OF REPORT')
	console.log('==========================================================')
}

export function printDiagnosticSummary(args) {
	printFinalMigrationReport(args)
}
