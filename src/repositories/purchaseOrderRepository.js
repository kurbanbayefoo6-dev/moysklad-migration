import { BaseRepository } from './baseRepository.js'

const PURCHASE_ORDER_EXPAND = [
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
].join(',')

export class PurchaseOrderRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/purchaseorder',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: PURCHASE_ORDER_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const purchaseOrderRepository = new PurchaseOrderRepository()

export default purchaseOrderRepository
