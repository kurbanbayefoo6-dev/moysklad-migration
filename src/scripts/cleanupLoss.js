import { pathToFileURL } from 'node:url'

import { lossRepository } from '../repositories/lossRepository.js'
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
				'Loss cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:loss -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewLosses() {
	const [oldLosses, newLosses] = await Promise.all([
		withApiRetries(
			() => lossRepository.findAll({ client: 'old' }),
			'GET OLD Loss',
		),
		withApiRetries(
			() => lossRepository.findAll({ client: 'new' }),
			'GET NEW Loss',
		),
	])
	const oldExternalCodes = new Set(
		oldLosses.map(loss => loss.externalCode).filter(Boolean),
	)

	return newLosses.filter(loss => oldExternalCodes.has(loss.externalCode))
}

export async function cleanupLoss({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const losses = await loadMigratedNewLosses()
	const stats = {
		found: losses.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Loss found: ${stats.found}`)

	for (let index = 0; index < losses.length; index += 1) {
		const loss = losses[index]
		console.log(`[${index + 1}/${losses.length}] Loss: ${getDocumentNumber(loss)}`)

		try {
			await withApiRetries(
				() => lossRepository.delete(loss.id, { client: 'new' }),
				`DELETE NEW ${lossRepository.endpoint}/${loss.id}`,
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
				number: getDocumentNumber(loss),
				id: loss.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete Loss')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Loss found: ${stats.found}`)
	console.log(`Loss deleted: ${stats.deleted}`)
	console.log(`Loss failed: ${stats.failed}`)
	console.log(
		stats.failed
			? 'Loss cleanup completed with failures.'
			: 'Loss cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupLoss({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Loss cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupLoss
