import { employeeResolver } from '../resolvers/EmployeeResolver.js'
import { organizationResolver } from '../resolvers/OrganizationResolver.js'
import { projectResolver } from '../resolvers/ProjectResolver.js'
import { warehouseResolver } from '../resolvers/WarehouseResolver.js'
import {
	copyScalarFields,
	getRows,
	isObject,
	lossAttributeResolver,
	lossStateResolver,
	mapAssortmentPosition,
	mapAttributes,
	removeUndefined,
	resolveOptionalReference,
	resolveRequiredReference,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'moment',
	'applicable',
	'description',
	'externalCode',
]

async function mapLossPosition(position, loss) {
	return mapAssortmentPosition(position, loss)
}

export class LossMapper {
	async map(loss) {
		if (!isObject(loss)) {
			throw new Error('Loss payload is required')
		}

		const payload = {}
		copyScalarFields(payload, loss, SCALAR_FIELDS)

		payload.organization = await resolveRequiredReference(
			loss.organization,
			organizationResolver,
			'Loss organization',
			'Organization not found',
		)
		payload.store = await resolveRequiredReference(
			loss.store,
			warehouseResolver,
			'Loss warehouse',
			'Warehouse not found',
		)

		const owner = await resolveOptionalReference(
			loss.owner,
			employeeResolver,
			'Owner',
			'Owner not found',
		)
		if (owner) {
			payload.owner = owner
		}

		const project = await resolveOptionalReference(
			loss.project,
			projectResolver,
			'Project',
			'Project not found',
		)
		if (project) {
			payload.project = project
		}

		const state = await resolveOptionalReference(loss.state, lossStateResolver, 'State')
		if (state) {
			payload.state = state
		}

		const attributes = await mapAttributes(loss.attributes, lossAttributeResolver)
		if (attributes) {
			payload.attributes = attributes
		}

		payload.positions = await Promise.all(
			getRows(loss.positions).map(position => mapLossPosition(position, loss)),
		)

		return removeUndefined(payload) || {}
	}
}

export const lossMapper = new LossMapper()

export default lossMapper
