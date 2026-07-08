import { shipmentMapper } from './mappers/shipmentMapper.js'
import { migrateOneShipment } from './migrations/migrateOneShipment.js'
import { shipmentRepository } from './repositories/shipmentRepository.js'
import { validateShipmentPayload } from './validators/shipmentValidator.js'

function getShipmentId(shipment) {
	return shipment?.id || shipment?.meta?.href || 'Unknown'
}

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || 'Unknown'
}

function getShipmentMoment(shipment) {
	return shipment?.moment || 'Unknown'
}

function printShipment(shipment, index) {
	console.log(`${index + 1}. API id: ${getShipmentId(shipment)}`)
	console.log(`   Shipment number: ${getShipmentNumber(shipment)}`)
	console.log(`   Moment: ${getShipmentMoment(shipment)}`)
}

function printFullError(error) {
	console.error(error?.stack || error?.message || String(error))
}

function printFinalPayload(payload) {
	console.log('Final payload')
	console.log(JSON.stringify(payload, null, 2))
}

function printPositionsDebug(shipment) {
	console.log('shipment.positions')
	console.log(JSON.stringify(shipment?.positions ?? null, null, 2))
	console.log('shipment.positions.meta')
	console.log(JSON.stringify(shipment?.positions?.meta ?? null, null, 2))
	console.log('shipment.positions.rows')
	console.log(JSON.stringify(shipment?.positions?.rows ?? null, null, 2))
}

async function main() {
	try {
		const response = await shipmentRepository
			.resolveClient('old')
			.get(shipmentRepository.endpoint, {
				params: {
					limit: 5,
					offset: 0,
				},
			})
		const shipments = Array.isArray(response?.rows)
			? response.rows
			: Array.isArray(response)
				? response
				: []
		const firstFiveShipments = shipments.slice(0, 5)

		for (const [index, shipment] of firstFiveShipments.entries()) {
			printShipment(shipment, index)
		}

		const selectedShipment = firstFiveShipments[0]
		if (!selectedShipment) {
			throw new Error('No shipments returned from OLD account')
		}

		const shipmentId = getShipmentId(selectedShipment)
		const fullShipment = await shipmentRepository.findById(shipmentId, {
			client: 'old',
		})

		console.log('Shipment loaded')
		printPositionsDebug(fullShipment)

		const mappedShipment = await shipmentMapper.map(fullShipment)
		console.log('Mapping successful')

		validateShipmentPayload(mappedShipment)
		console.log('Validation successful')

		await migrateOneShipment(getShipmentId(selectedShipment), {
			dryRun: false,
			silent: false,
			shipmentMapper,
			validator: validateShipmentPayload,
		})
	} catch (error) {
		printFullError(error)
		process.exitCode = 1
	}
}

await main()
