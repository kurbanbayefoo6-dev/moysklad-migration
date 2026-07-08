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
}

export const shipmentService = new ShipmentService()

export default shipmentService
