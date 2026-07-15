import { pathToFileURL } from 'node:url'

import { paymentInRepository } from '../repositories/paymentInRepository.js'
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
				'PaymentIn cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:paymentin -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewPaymentIns() {
	const [oldPayments, newPayments] = await Promise.all([
		withApiRetries(
			() => paymentInRepository.findAll({ client: 'old' }),
			'GET OLD Incoming Payments',
		),
		withApiRetries(
			() => paymentInRepository.findAll({ client: 'new' }),
			'GET NEW Incoming Payments',
		),
	])
	const oldExternalCodes = new Set(
		oldPayments.map(payment => payment.externalCode).filter(Boolean),
	)

	return newPayments.filter(payment => oldExternalCodes.has(payment.externalCode))
}

export async function cleanupPaymentIn({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const payments = await loadMigratedNewPaymentIns()
	const stats = {
		found: payments.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Incoming Payments found: ${stats.found}`)

	for (let index = 0; index < payments.length; index += 1) {
		const payment = payments[index]
		console.log(`[${index + 1}/${payments.length}] Incoming Payment: ${getDocumentNumber(payment)}`)

		try {
			await withApiRetries(
				() => paymentInRepository.delete(payment.id, { client: 'new' }),
				`DELETE NEW ${paymentInRepository.endpoint}/${payment.id}`,
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
			console.log('Failed to delete Incoming Payment')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Incoming Payments found: ${stats.found}`)
	console.log(`Incoming Payments deleted: ${stats.deleted}`)
	console.log(`Incoming Payments failed: ${stats.failed}`)
	console.log(
		stats.failed ? 'PaymentIn cleanup completed with failures.' : 'PaymentIn cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupPaymentIn({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('PaymentIn cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupPaymentIn
