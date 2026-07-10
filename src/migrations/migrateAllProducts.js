import { fileURLToPath } from 'node:url'
import { productRepository } from '../repositories/productRepository.js'
import { migrateOneProduct } from './migrateOneProduct.js'

function getProductLabel(product) {
	return product?.name || product?.code || product?.externalCode || product?.id || ''
}

function getProductId(product) {
	return product?.id || ''
}

function getProductName(product) {
	return product?.name || ''
}

function getProductCode(product) {
	return product?.code || ''
}

function getProductExternalCode(product) {
	return product?.externalCode || ''
}

function printFinalSummary({ total, created, skipped, failed }) {
	console.log('--------------------------------')
	console.log('Migration finished')
	console.log(`Total: ${total}`)
	console.log(`Created: ${created}`)
	console.log(`Skipped: ${skipped}`)
	console.log(`Failed: ${failed}`)
	console.log('--------------------------------')
}

function printFailure(product, error) {
	console.log('========================================')
	console.log('FAILED PRODUCT')
	console.log('')
	console.log(`Product ID: ${getProductId(product)}`)
	console.log(`Product Name: ${getProductName(product)}`)
	console.log(`Product Code: ${getProductCode(product)}`)
	console.log(`External Code: ${getProductExternalCode(product)}`)
	console.log('')
	console.log('Reason:')
	console.log(error?.message || 'Unknown error')
	console.log('')
	console.log('Stack:')
	console.log(error?.stack || '')
	console.log('========================================')
}

function printFailedProducts(failedProducts) {
	if (!failedProducts.length) {
		return
	}

	console.log('--------------------------------')
	console.log('Failed products:')
	console.log('')

	for (const [index, failedProduct] of failedProducts.entries()) {
		console.log(`${index + 1}.`)
		console.log(`Product ID: ${failedProduct.productId}`)
		console.log(`Product Name: ${failedProduct.productName}`)
		console.log(`Code: ${failedProduct.code}`)
		console.log(`External Code: ${failedProduct.externalCode}`)
		console.log(`Reason: ${failedProduct.reason}`)
		console.log('')
	}

	console.log('--------------------------------')
}

export async function migrateAllProducts({
	dryRun = false,
	productRepository: productRepositoryInstance = productRepository,
	migrateOneProduct: migrateOneProductFn = migrateOneProduct,
} = {}) {
	const oldProducts =
		typeof productRepositoryInstance.findAllByEndpoint === 'function'
			? await productRepositoryInstance.findAllByEndpoint('entity/product', {
					client: 'old',
				})
			: await productRepositoryInstance.findAll({ client: 'old' })
	const total = oldProducts.length

	let created = 0
	let skipped = 0
	let failed = 0
	const failedProducts = []

	for (let index = 0; index < oldProducts.length; index += 1) {
		const product = oldProducts[index]
		console.log(`[${index + 1}/${total}]`)
		console.log(`Product: ${getProductLabel(product)}`)

		try {
			const result = await migrateOneProductFn(product.id, {
				dryRun,
				productRepository: productRepositoryInstance,
			})
			if (result?.skipped) {
				skipped += 1
				console.log('Skipped')
			} else {
				created += 1
				console.log('Created')
			}
		} catch (error) {
			failed += 1
			failedProducts.push({
				productId: getProductId(product),
				productName: getProductName(product),
				code: getProductCode(product),
				externalCode: getProductExternalCode(product),
				reason: error?.message || 'Unknown error',
			})
			printFailure(product, error)
		}
	}

	printFinalSummary({ total, created, skipped, failed })
	printFailedProducts(failedProducts)

	return { total, created, skipped, failed, failedProducts }
}

export default migrateAllProducts

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await migrateAllProducts({
		dryRun: false,
	})
}
