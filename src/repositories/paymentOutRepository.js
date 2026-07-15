import { BaseRepository } from './baseRepository.js'

const PAYMENT_OUT_EXPAND = [
	'operations',
	'organization',
	'organizationAccount',
	'agent',
	'agentAccount',
	'contract',
	'project',
	'state',
	'rate.currency',
	'expenseItem',
].join(',')

export class PaymentOutRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/paymentout',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: PAYMENT_OUT_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const paymentOutRepository = new PaymentOutRepository()

export default paymentOutRepository
