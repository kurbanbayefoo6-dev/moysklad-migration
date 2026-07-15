import { BaseRepository } from './baseRepository.js'

const MOVE_EXPAND = [
	'organization',
	'sourceStore',
	'targetStore',
	'positions.assortment',
	'state',
	'project',
	'owner',
	'group',
].join(',')

export class MoveRepository extends BaseRepository {
	constructor(options = {}) {
		super({
			endpoint: 'entity/move',
			...options,
		})
	}

	findById(id, options = {}) {
		return super.findById(id, {
			...options,
			params: {
				expand: MOVE_EXPAND,
				...(options.params || {}),
			},
		})
	}
}

export const moveRepository = new MoveRepository()

export default moveRepository
