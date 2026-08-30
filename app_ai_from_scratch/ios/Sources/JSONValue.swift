import Foundation

/// JSON heterogéneo con tipo. Existe porque el payload de un lab cambia de forma
/// por mecánica (`options`, `words`, `steps`, `tiles`, `min/max`…) y la respuesta
/// de un intento también (`hint` es `{err,word}` o `{range:[a,b]}` o null).
/// Modelarlo con seis structs opcionales por rama es más código y más frágil que
/// un valor JSON de verdad; `Any` a pelo pierde Decodable y Equatable.
enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSONValue].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "JSON irreconocible") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    // Accesores con nombre de lo que el payload real trae.
    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }
    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    var numberValue: Double? { if case .number(let n) = self { return n }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let a) = self { return a }; return nil }

    var strings: [String]? { arrayValue?.compactMap { $0.stringValue } }
}
