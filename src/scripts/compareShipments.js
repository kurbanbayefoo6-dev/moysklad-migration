import { pathToFileURL } from 'node:url'

import { shipmentMapper } from '../mappers/shipmentMapper.js'
import { shipmentRepository } from '../repositories/shipmentRepository.js'
import {
	buildShipmentIdentityKey,
	buildShipmentIdentityMap,
	findShipmentIdentityCandidates,
	prepareShipmentForIdentity,
} from '../utils/shipmentIdentity.js'

const EXPAND = 'organization,store,agent,counterparty,positions.assortment'

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || shipment?.id || ''
}

export async function compareShipments() {
	const oldShipments = await shipmentRepository.findAll({ client: 'old' })
	const newShipments = await shipmentRepository.findAll({
		client: 'new',
		params: { expand: EXPAND },
	})
	const newShipmentMap = buildShipmentIdentityMap(newShipments)
	let matched = 0
	let missing = 0
	let different = 0

	for (const oldShipmentSummary of oldShipments) {
		const oldShipment = await shipmentRepository.findById(oldShipmentSummary.id, {
			client: 'old',
		})
		const expectedShipment = prepareShipmentForIdentity(
			await shipmentMapper.map(oldShipment),
			oldShipment,
		)
		const exactMatch = newShipmentMap.get(buildShipmentIdentityKey(expectedShipment))?.[0]

		if (exactMatch) {
			matched += 1
			continue
		}

		const candidates = findShipmentIdentityCandidates(expectedShipment, newShipments)
		if (candidates.length) {
			different += 1
		} else {
			missing += 1
		}
	}

	console.log(`Matched shipments: ${matched}`)
	console.log(`Missing shipments: ${missing}`)
	console.log(`Different shipments: ${different}`)

	return { matched, missing, different }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	compareShipments().catch(error => {
		console.log(error?.message || 'Comparison failed')
		process.exitCode = 1
	})
}

export default compareShipments
