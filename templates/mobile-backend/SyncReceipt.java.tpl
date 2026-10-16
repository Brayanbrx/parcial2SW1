package __PACKAGE__.mobilesupport;

import jakarta.persistence.*;

/** Durable acknowledgement: a retried operation never executes twice. */
@Entity
@Table(name = "_uml_sync_receipts")
public class SyncReceipt {
    @Id @Column(length = 36) public String operationId;
    @Column(nullable = false, length = 120) public String actor;
    @Column(nullable = false, columnDefinition = "text") public String requestJson;
    @Column(nullable = false, columnDefinition = "text") public String responseJson;
    protected SyncReceipt() {}
    SyncReceipt(String operationId, String actor, String requestJson, String responseJson) {
        this.operationId = operationId; this.actor = actor;
        this.requestJson = requestJson; this.responseJson = responseJson;
    }
}
