import { pathToFileURL } from 'node:url'

import { inventoryRepository } from '../repositories/inventoryRepository.js'
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
				'Inventory cleanup deletes documents from the NEW account only.',
				`Re-run with ${CONFIRM_FLAG} to confirm NEW-account deletion.`,
				'Example: npm.cmd run cleanup:inventory -- --confirm-new-account',
			].join('\n'),
		)
	}
}

async function loadMigratedNewInventories() {
	const [oldInventories, newInventories] = await Promise.all([
		withApiRetries(
			() => inventoryRepository.findAll({ client: 'old' }),
			'GET OLD Inventory',
		),
		withApiRetries(
			() => inventoryRepository.findAll({ client: 'new' }),
			'GET NEW Inventory',
		),
	])
	const oldExternalCodes = new Set(
		oldInventories.map(inventory => inventory.externalCode).filter(Boolean),
	)

	return newInventories.filter(inventory =>
		oldExternalCodes.has(inventory.externalCode),
	)
}

export async function cleanupInventory({ confirmed = false } = {}) {
	assertSafetyConfirmation({ confirmed })

	const inventories = await loadMigratedNewInventories()
	const stats = {
		found: inventories.length,
		deleted: 0,
		failed: 0,
		failures: [],
	}

	console.log(`Inventory found: ${stats.found}`)

	for (let index = 0; index < inventories.length; index += 1) {
		const inventory = inventories[index]
		console.log(
			`[${index + 1}/${inventories.length}] Inventory: ${getDocumentNumber(inventory)}`,
		)

		try {
			await withApiRetries(
				() => inventoryRepository.delete(inventory.id, { client: 'new' }),
				`DELETE NEW ${inventoryRepository.endpoint}/${inventory.id}`,
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
				number: getDocumentNumber(inventory),
				id: inventory.id,
				reason: error?.message || 'Unknown error',
			})
			console.log('Failed to delete Inventory')
			console.log(formatApiError(error))
		}
	}

	console.log('')
	console.log(`Inventory found: ${stats.found}`)
	console.log(`Inventory deleted: ${stats.deleted}`)
	console.log(`Inventory failed: ${stats.failed}`)
	console.log(
		stats.failed
			? 'Inventory cleanup completed with failures.'
			: 'Inventory cleanup completed successfully.',
	)

	if (stats.failed) {
		process.exitCode = 1
	}

	return stats
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	cleanupInventory({
		confirmed: process.argv.includes(CONFIRM_FLAG),
	}).catch(error => {
		console.log('Inventory cleanup stopped')
		console.log(formatApiError(error))
		process.exitCode = 1
	})
}

export default cleanupInventory
