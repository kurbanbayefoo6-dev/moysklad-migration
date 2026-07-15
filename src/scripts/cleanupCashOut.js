import { pathToFileURL } from 'node:url'

import { cashOutRepository } from '../repositories/cashOutRepository.js'
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
				'CashOut cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:cashout -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewCashOuts() {
	const [oldCashOuts, newCashOuts] = await Promise.all([
		withApiRetries(
			() => cashOutRepository.findAll({ client: 'old' }),
			'GET OLD CashOut',
		),
		withApiRetries(
			() => cashOutRepository.findAll({ client: 'new' }),
			'GET NEW CashOut',
		),
	])
	const oldExternalCodes = new Set(
		oldCashOuts.map(cashOut => cashOut.externalCode).filter(Boolean),
	)

	return newCashOuts.filter(cashOut => oldExternalCodes.has(cashOut.externalCode))
}

export async function cleanupCashOut({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const cashOuts = await loadMigratedNewCashOuts()
	const stats = {
		found: cashOuts.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`CashOut found: ${stats.found}`)

	for (let index = 0; index < cashOuts.length; index += 1) {
		const cashOut = cashOuts[index]
		console.log(`[${index + 1}/${cashOuts.length}] CashOut: ${getDocumentNumber(cashOut)}`)

		try {
			await withApiRetries(
				() => cashOutRepository.delete(cashOut.id, { client: 'new' }),
				`DELETE NEW ${cashOutRepository.endpoint}/${cashOut.id}`,
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
				number: getDocumentNumber(cashOut),
				id: cashOut.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete CashOut')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`CashOut found: ${stats.found}`)
	console.log(`CashOut deleted: ${stats.deleted}`)
	console.log(`CashOut failed: ${stats.failed}`)
	console.log(
		stats.failed ? 'CashOut cleanup completed with failures.' : 'CashOut cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupCashOut({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('CashOut cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupCashOut
