import { shipmentRepository } from './repositories/shipmentRepository.js'

function getShipmentNumber(shipment) {
	return shipment?.name || shipment?.number || shipment?.code || 'Unknown'
}

function getShipmentId(shipment) {
	return shipment?.id || shipment?.meta?.href || 'Unknown'
}

function getShipmentMoment(shipment) {
	return shipment?.moment || 'Unknown'
}

function printShipment(shipment, index) {
	console.log(`${index + 1}. API id: ${getShipmentId(shipment)}`)
	console.log(`   Shipment number (name): ${getShipmentNumber(shipment)}`)
	console.log(`   Moment: ${getShipmentMoment(shipment)}`)
}

async function main() {
	try {
		const shipments = await shipmentRepository.findAll({
			client: 'old',
			pageSize: 5,
		})
		const firstFiveShipments = shipments.slice(0, 5)

		console.log('Loaded first 5 shipments from OLD account.')
		for (const [index, shipment] of firstFiveShipments.entries()) {
			printShipment(shipment, index)
		}
	} catch (error) {
		console.error(error?.message || 'Failed to load shipments')
		process.exitCode = 1
	}
}

await main()
