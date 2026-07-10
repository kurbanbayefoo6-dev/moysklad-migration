import { shipmentMapper } from '../mappers/shipmentMapper.js'
import { shipmentRepository } from '../repositories/shipmentRepository.js'
import {
	buildShipmentIdentityKey,
	buildShipmentIdentityMap,
	compareShipmentContent,
	describeShipmentIdentity,
	findShipmentIdentityCandidates,
	prepareShipmentForIdentity,
} from '../utils/shipmentIdentity.js'
import {
	finishShipmentFailure,
	finishShipmentSuccess,
	printFinalMigrationReport,
	resetDiagnostics,
	setOldShipmentCount,
	startShipmentDiagnostics,
} from '../utils/migrationDiagnostics.js'
import { migrateOneShipment } from './migrateOneShipment.js'

const RECONCILIATION_EXPAND =
	'organization,store,agent,counterparty,positions.assortment'

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || shipment?.id || ''
}

function printProgress(current, total, shipment) {
	return { current, total, shipment }
}

function printFinalSummary({ created, skipped, failed, total }) {
	return { created, skipped, failed, total }
}

function printShipmentLoadingSummary(paginationInfo) {
	return paginationInfo
}

function printFailedShipment(shipment, error) {
	return { shipment, error }
}

function printFailedShipments(failedShipments) {
	return failedShipments
}

async function mapOldShipmentForReconciliation(
	shipmentRepositoryInstance,
	oldShipmentSummary,
) {
	const oldShipment = await shipmentRepositoryInstance.findById(
		oldShipmentSummary.id,
		{ client: 'old' },
	)
	const mappedShipment = await shipmentMapper.map(oldShipment)

	return {
		oldShipment,
		mappedShipment: prepareShipmentForIdentity(mappedShipment, oldShipment),
	}
}

function findDiagnosticCandidates(mappedOldShipment, newShipments) {
	return findShipmentIdentityCandidates(mappedOldShipment, newShipments)
}

function formatDifferences(differences) {
	return differences
		.map(
			difference =>
				`${difference.field}: OLD=${difference.left || ''} NEW=${difference.right || ''}`,
		)
		.join('\n')
}

function printDifferentShipment({ oldShipment, mappedShipment, candidates }) {
	return { oldShipment, mappedShipment, candidates }
}

function printMissingShipment({ oldShipment, mappedShipment }) {
	return { oldShipment, mappedShipment }
}

async function printShipmentReconciliationReport(shipmentRepositoryInstance) {
	const oldShipments = await shipmentRepositoryInstance.findAll({
		client: 'old',
	})
	const newShipments = await shipmentRepositoryInstance.findAll({
		client: 'new',
		params: {
			expand: RECONCILIATION_EXPAND,
		},
	})
	const newShipmentMap = buildShipmentIdentityMap(newShipments)
	const missingShipments = []
	const differentShipments = []
	let matched = 0

	for (let index = 0; index < oldShipments.length; index += 1) {
		const { oldShipment, mappedShipment } =
			await mapOldShipmentForReconciliation(
				shipmentRepositoryInstance,
				oldShipments[index],
			)
		const key = buildShipmentIdentityKey(mappedShipment)
		const exactMatch = newShipmentMap.get(key)?.[0]

		if (exactMatch) {
			const contentDifferences = compareShipmentContent(mappedShipment, exactMatch)
			if (contentDifferences.length > 0) {
				differentShipments.push({
					oldShipment,
					mappedShipment,
					candidates: [exactMatch],
				})
			} else {
				matched += 1
			}
			continue
		}

		const candidates = findDiagnosticCandidates(mappedShipment, newShipments)
		if (candidates.length > 0) {
			differentShipments.push({
				oldShipment,
				mappedShipment,
				candidates,
			})
		} else {
			missingShipments.push({ oldShipment, mappedShipment })
		}
	}

	for (const item of missingShipments) {
		printMissingShipment(item)
	}

	for (const item of differentShipments) {
		printDifferentShipment(item)
	}

	return {
		matched,
		missingShipments,
		differentShipments,
	}
}

export async function migrateAllShipments({
	dryRun = false,
	shipmentRepository: shipmentRepositoryInstance = shipmentRepository,
	migrateOneShipment: migrateOneShipmentFn = migrateOneShipment,
} = {}) {
	resetDiagnostics()
	const oldShipments = await shipmentRepositoryInstance.findAll({ client: 'old' })
	const total = oldShipments.length
	setOldShipmentCount(total)

	let created = 0
	let skipped = 0
	let failed = 0
	const failedShipments = []

	for (let index = 0; index < oldShipments.length; index += 1) {
		const shipment = oldShipments[index]
		startShipmentDiagnostics(shipment, shipment?.id || '')

		try {
			const result = await migrateOneShipmentFn(shipment.id, { dryRun })
			if (result?.skipped) {
				skipped += 1
			} else {
				created += 1
			}
			finishShipmentSuccess(result)
		} catch (error) {
			failed += 1
			finishShipmentFailure(error)
			failedShipments.push({
				shipmentId: shipment?.id || '',
				shipmentNumber: getShipmentNumber(shipment),
				reason: error?.message || 'Unknown error',
			})
		}
	}

	printFinalMigrationReport({ oldShipments: total, created, failed })

	return { created, skipped, failed, total, failedShipments, reconciliation: null }
}

export default migrateAllShipments
