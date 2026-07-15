import { pathToFileURL } from 'node:url'

import { enterRepository } from '../repositories/enterRepository.js'
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
				'Enter cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:enter -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewEnters() {
	const [oldEnters, newEnters] = await Promise.all([
		withApiRetries(
			() => enterRepository.findAll({ client: 'old' }),
			'GET OLD Enter',
		),
		withApiRetries(
			() => enterRepository.findAll({ client: 'new' }),
			'GET NEW Enter',
		),
	])
	const oldExternalCodes = new Set(
		oldEnters.map(enter => enter.externalCode).filter(Boolean),
	)

	return newEnters.filter(enter => oldExternalCodes.has(enter.externalCode))
}

export async function cleanupEnter({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const enters = await loadMigratedNewEnters()
	const stats = {
		found: enters.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Enter found: ${stats.found}`)

	for (let index = 0; index < enters.length; index += 1) {
		const enter = enters[index]
		console.log(`[${index + 1}/${enters.length}] Enter: ${getDocumentNumber(enter)}`)

		try {
			await withApiRetries(
				() => enterRepository.delete(enter.id, { client: 'new' }),
				`DELETE NEW ${enterRepository.endpoint}/${enter.id}`,
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
				number: getDocumentNumber(enter),
				id: enter.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete Enter')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Enter found: ${stats.found}`)
	console.log(`Enter deleted: ${stats.deleted}`)
	console.log(`Enter failed: ${stats.failed}`)
	console.log(
		stats.failed
			? 'Enter cleanup completed with failures.'
			: 'Enter cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupEnter({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Enter cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupEnter
