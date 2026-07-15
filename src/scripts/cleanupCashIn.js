import { pathToFileURL } from 'node:url'

import { cashInRepository } from '../repositories/cashInRepository.js'
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
				'CashIn cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:cashin -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewCashIns() {
	const [oldCashIns, newCashIns] = await Promise.all([
		withApiRetries(
			() => cashInRepository.findAll({ client: 'old' }),
			'GET OLD CashIn',
		),
		withApiRetries(
			() => cashInRepository.findAll({ client: 'new' }),
			'GET NEW CashIn',
		),
	])
	const oldExternalCodes = new Set(
		oldCashIns.map(cashIn => cashIn.externalCode).filter(Boolean),
	)

	return newCashIns.filter(cashIn => oldExternalCodes.has(cashIn.externalCode))
}

export async function cleanupCashIn({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const cashIns = await loadMigratedNewCashIns()
	const stats = {
		found: cashIns.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`CashIn found: ${stats.found}`)

	for (let index = 0; index < cashIns.length; index += 1) {
		const cashIn = cashIns[index]
		console.log(`[${index + 1}/${cashIns.length}] CashIn: ${getDocumentNumber(cashIn)}`)

		try {
			await withApiRetries(
				() => cashInRepository.delete(cashIn.id, { client: 'new' }),
				`DELETE NEW ${cashInRepository.endpoint}/${cashIn.id}`,
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
				number: getDocumentNumber(cashIn),
				id: cashIn.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete CashIn')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`CashIn found: ${stats.found}`)
	console.log(`CashIn deleted: ${stats.deleted}`)
	console.log(`CashIn failed: ${stats.failed}`)
	console.log(
		stats.failed ? 'CashIn cleanup completed with failures.' : 'CashIn cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupCashIn({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('CashIn cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupCashIn
