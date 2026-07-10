import { BaseRepository } from './baseRepository.js'

function normalizeItems(response) {
	if (Array.isArray(response)) {
		return response
	}

	if (Array.isArray(response?.rows)) {
		return response.rows
	}

	if (Array.isArray(response?.items)) {
		return response.items
	}

	return []
}

export class ShipmentRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/demand',
			...options,
		})
	}

	async findAll(options = {}) {
		const client = this.resolveClient(options.client)
		const pageSize = options.pageSize || this.pageSize
		const params = options.params || {}
		const shipments = []
		const paginationRequests = []
		let offset = 0
		let metaSize

		for (;;) {
			const response = await client.get(this.endpoint, {
				params: {
					...params,
					limit: pageSize,
					offset,
				},
			})

			if (typeof response?.meta?.size === 'number') {
				metaSize = response.meta.size
			}

			const pageShipments = normalizeItems(response)
			shipments.push(...pageShipments)
			paginationRequests.push({
				offset,
				limit: pageSize,
				rows: pageShipments.length,
				metaSize: metaSize ?? null,
			})

			if (options.logPagination) {
				console.log(
					`Shipment API request: offset=${offset} limit=${pageSize} rows=${pageShipments.length} meta.size=${metaSize ?? 'Unknown'}`,
				)
			}

			if (
				typeof metaSize === 'number' &&
				shipments.length >= metaSize
			) {
				break
			}

			const nextOffset = offset + pageSize
			if (
				pageShipments.length < pageSize &&
				(typeof metaSize !== 'number' || nextOffset >= metaSize)
			) {
				break
			}

			offset = nextOffset
		}

		shipments.paginationInfo = {
			metaSize: metaSize ?? null,
			loaded: shipments.length,
			requests: paginationRequests,
		}

		return shipments
	}

	async findById(id, options = {}) {
		const expand = [
			'organization',
			'store',
			'counterparty',
			'agent',
			'contract',
			'project',
			'state',
			'rate.currency',
			'organizationAccount',
			'positions.assortment',
		]

		const params = {
			...(options.params || {}),
			expand: expand.join(','),
		}

		return super.findById(id, {
			...options,
			params,
		})
	}
}

export const shipmentRepository = new ShipmentRepository()

export default shipmentRepository
