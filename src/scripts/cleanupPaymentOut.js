import { pathToFileURL } from 'node:url'

import {
	getPurchaseGraphOperations,
} from '../mappers/paymentOutMapper.js'
import { paymentOutRepository } from '../repositories/paymentOutRepository.js'
import { withApiRetries } from '../utils/apiRetry.js'

const CONFIRM_FLAG = '--confirm-new-account'

function getDocumentNumber(document) {
	return document?.name || document?.number || document?.code || document?.id || ''
}

function isNotFound(error) {
	return error?.status === 404 || /not found/i.test(error?.message || '')
}

function formatApiError(error) {
	const body =
		error?.responseBody ||
		error?.response?.data ||
		error?.data ||
		error?.body ||
		null

	if (body) {
		return `${error?.message || 'API error'}\n${JSON.stringify(body, null, 2)}`
	}

	return error?.message || 'Unknown API error'
}

function assertSafetyConfirmation({ confirmed }) {
	if (!confirmed) {
		throw new Error(
			[
				'Standalone PaymentOut cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:paymentout -- --confirm-new-account',
			].join('\n'),
		)
	}
}

function getStandaloneExternalCodes(oldPayments) {
	return new Set(
		oldPayments
			.filter(payment => getPurchaseGraphOperations(payment).length === 0)
			.map(payment => payment.externalCode)
			.filter(Boolean),
	)
}

async function loadOldPaymentOutDetails() {
	const summaries = await withApiRetries(
		() => paymentOutRepository.findAll({ client: 'old' }),
		'GET OLD Outgoing Payments',
	)
	const details = []

	for (const summary of summaries) {
		details.push(
			await withApiRetries(
				() => paymentOutRepository.findById(summary.id, { client: 'old' }),
				`GET OLD ${paymentOutRepository.endpoint}/${summary.id}`,
			),
		)
	}

	return details
}

async function loadStandaloneNewPaymentOuts() {
	const [oldPayments, newPayments] = await Promise.all([
		loadOldPaymentOutDetails(),
		withApiRetries(
			() =>
				paymentOutRepository.findAll({
					client: 'new',
					params: { expand: 'operations' },
				}),
			'GET NEW Outgoing Payments',
		),
	])
	const standaloneExternalCodes = getStandaloneExternalCodes(oldPayments)

	return newPayments.filter(
		payment =>
			standaloneExternalCodes.has(payment.externalCode) &&
			getPurchaseGraphOperations(payment).length === 0,
	)
}

export async function cleanupPaymentOut({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const payments = await loadStandaloneNewPaymentOuts()
	const stats = {
		found: payments.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Standalone PaymentOut found: ${stats.found}`)

	for (let index = 0; index < payments.length; index += 1) {
		const payment = payments[index]
		console.log(`[${index + 1}/${payments.length}] PaymentOut: ${getDocumentNumber(payment)}`)

		try {
			await withApiRetries(
				() => paymentOutRepository.delete(payment.id, { client: 'new' }),
				`DELETE NEW ${paymentOutRepository.endpoint}/${payment.id}`,
			)
			stats.deleted += 1
			console.log('Deleted')
		} catch (error) {
			if (isNotFound(error)) {
				stats.deleted += 1
				console.log('Skipped: already deleted')
				continue
			}

			stats.failed += 1
			stats.failures.push({
				number: getDocumentNumber(payment),
				id: payment.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete PaymentOut')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Standalone PaymentOut found: ${stats.found}`)
	console.log(`Standalone PaymentOut deleted: ${stats.deleted}`)
	console.log(`Standalone PaymentOut failed: ${stats.failed}`)
	console.log(
		stats.failed
			? 'Standalone PaymentOut cleanup completed with failures.'
			: 'Standalone PaymentOut cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupPaymentOut({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Standalone PaymentOut cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupPaymentOut
