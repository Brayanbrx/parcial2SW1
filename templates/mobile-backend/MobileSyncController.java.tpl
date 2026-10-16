package __PACKAGE__.mobilesupport;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.validation.Validator;
import java.security.Principal;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
public class MobileSyncController {
    private final EntityManager em;
    private final ObjectMapper json;
    private final Validator validator;
    private final Map<String, Handler> resources;
    private record Handler(Class<?> entity, Class<?> dto, Function<JsonNode, Object> key,
            Function<Object, Object> read, Function<Object, Object> create,
            BiFunction<Object, Object, Object> update, Consumer<Object> delete, String primaryKey) {}
    public record Change(String operationId, String resource, String method, JsonNode id, JsonNode data, JsonNode base) {}
    @ExceptionHandler(ResponseStatusException.class)
    public org.springframework.http.ResponseEntity<__PACKAGE__.exception.ApiError> conflict(ResponseStatusException error, jakarta.servlet.http.HttpServletRequest request) {
        return org.springframework.http.ResponseEntity.status(error.getStatusCode()).body(new __PACKAGE__.exception.ApiError(java.time.Instant.now(),error.getStatusCode().value(),"Sync error",error.getReason(),request.getRequestURI(),Map.of()));
    }

    public MobileSyncController(EntityManager em, ObjectMapper json, Validator validator__DEPENDENCIES__) {
        this.em = em; this.json = json; this.validator = validator;
        this.resources = Map.ofEntries(__HANDLERS__);
    }

    @PostMapping("/mobile-sync")
    @Transactional
    public JsonNode apply(@RequestBody Change change, Principal principal) {
        if (change.operationId() == null || change.resource() == null || change.id() == null || change.id().isNull()
                || !change.id().isValueNode() || change.method() == null || !java.util.List.of("POST", "PUT", "DELETE").contains(change.method()))
            throw new IllegalArgumentException("Operacion de sincronizacion invalida.");
        UUID.fromString(change.operationId());
        var handler = resources.get(change.resource());
        if (handler == null) throw new IllegalArgumentException("Recurso desconocido.");
        // Serialize short sync transactions across replicas, including creates with no row to lock.
        em.createNativeQuery("select pg_advisory_xact_lock(73519062026)").getSingleResult();
        var request = json.valueToTree(change);
        var receipt = em.find(SyncReceipt.class, change.operationId());
        if (receipt != null) {
            if (!receipt.actor.equals(principal.getName()) || !json.readTree(receipt.requestJson).equals(request))
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Identificador de operacion reutilizado con otro contenido.");
            return json.readTree(receipt.responseJson);
        }
        var id = handler.key().apply(change.id());
        var entity = em.find(handler.entity(), id, LockModeType.PESSIMISTIC_WRITE);
        JsonNode current = entity == null ? json.valueToTree(null) : json.readTree(json.writeValueAsString(handler.read().apply(id)));
        if (change.method().equals("POST") && entity != null)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "La clave ya existe. Revisa el registro local.");
        if (!change.method().equals("POST") && entity != null && (change.base() == null || !current.equals(change.base())))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El registro cambio en el servidor. Revisa el conflicto.");
        Object result = null;
        if (change.method().equals("DELETE")) {
            if (entity != null) handler.delete().accept(id);
        } else {
            if (change.data() == null || !change.data().isObject()) throw new IllegalArgumentException("Falta el DTO.");
            if (!change.data().hasNonNull(handler.primaryKey()) || !handler.key().apply(change.data().get(handler.primaryKey())).equals(id))
                throw new IllegalArgumentException("La clave del DTO no coincide con la operacion.");
            Object dto;
            try { dto = json.treeToValue(change.data(), handler.dto()); }
            catch (RuntimeException error) { throw new IllegalArgumentException("El DTO no cumple sus tipos."); }
            var violations = validator.validate(dto);
            if (!violations.isEmpty()) throw new IllegalArgumentException(violations.iterator().next().getPropertyPath() + ": " + violations.iterator().next().getMessage());
            if (change.method().equals("PUT") && entity == null)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "El registro fue eliminado en el servidor.");
            result = change.method().equals("POST") ? handler.create().apply(dto) : handler.update().apply(id, dto);
        }
        em.flush();
        var response = json.valueToTree(Map.of("operationId", change.operationId(), "data", result == null ? json.valueToTree(null) : result));
        em.persist(new SyncReceipt(change.operationId(), principal.getName(), json.writeValueAsString(request), json.writeValueAsString(response)));
        return response;
    }
}
