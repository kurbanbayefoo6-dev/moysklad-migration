import { BaseRepository } from './baseRepository.js'

const SUPPLY_EXPAND = [
	'purchaseOrder',
	'organization',
	'organizationAccount',
	'agent',
	'agentAccount',
	'contract',
	'store',
	'project',
	'state',
	'rate.currency',
	'positions.assortment',
	'positions.country',
].join(',')

export class SupplyRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/supply',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: SUPPLY_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const supplyRepository = new SupplyRepository()

export default supplyRepository
