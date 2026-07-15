import { pathToFileURL } from 'node:url'

import { moveRepository } from '../repositories/moveRepository.js'
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
				'Move cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:move -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewMoves() {
	const [oldMoves, newMoves] = await Promise.all([
		withApiRetries(
			() => moveRepository.findAll({ client: 'old' }),
			'GET OLD Move',
		),
		withApiRetries(
			() => moveRepository.findAll({ client: 'new' }),
			'GET NEW Move',
		),
	])
	const oldExternalCodes = new Set(
		oldMoves.map(move => move.externalCode).filter(Boolean),
	)

	return newMoves.filter(move => oldExternalCodes.has(move.externalCode))
}

export async function cleanupMove({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const moves = await loadMigratedNewMoves()
	const stats = {
		found: moves.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Move found: ${stats.found}`)

	for (let index = 0; index < moves.length; index += 1) {
		const move = moves[index]
		console.log(`[${index + 1}/${moves.length}] Move: ${getDocumentNumber(move)}`)

		try {
			await withApiRetries(
				() => moveRepository.delete(move.id, { client: 'new' }),
				`DELETE NEW ${moveRepository.endpoint}/${move.id}`,
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
				number: getDocumentNumber(move),
				id: move.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete Move')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Move found: ${stats.found}`)
	console.log(`Move deleted: ${stats.deleted}`)
	console.log(`Move failed: ${stats.failed}`)
	console.log(
		stats.failed
			? 'Move cleanup completed with failures.'
			: 'Move cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupMove({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Move cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupMove
