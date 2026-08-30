module course/security

go 1.26.2

require (
	course/queue v0.0.0
	github.com/google/uuid v1.6.0
)

require github.com/rabbitmq/amqp091-go v1.14.0 // indirect

// The bus envelope, the broker and the retry tiers are NOT reimplemented here.
// House rule: generate from the source of truth, never a copy. A second envelope
// implementation is a fourth wire format that nothing compares, and this fleet
// has already been bitten by exactly that -- `typeof [] === 'object'` let an
// array payload through Node while Python and Go both refused it.
replace course/queue => ../queue
