import { shipmentRepository } from '../repositories/shipmentRepository.js'

export class ShipmentService {
	constructor(repository = shipmentRepository) {
		this.repository = repository
	}

	async getById(id, options = {}) {
		return this.repository.findById(id, {
			client: options.client || 'old',
			params: options.params,
		})
	}

	async create(payload, options = {}) {
		return this.repository.create(payload, {
			client: options.client || 'new',
			params: options.params,
		})
	}

	async findAllByMoment(moment, options = {}) {
		if (!moment) {
			return []
		}

		const filter = [`moment=${moment}`]
		if (options.params?.filter) {
			filter.push(options.params.filter)
		}

		const client = this.repository.resolveClient(options.client || 'new')
		return this.repository.paginate(client, {
			params: {
				...options.params,
				filter: filter.join(';'),
			},
		})
	}
}

export const shipmentService = new ShipmentService()

export default shipmentService
