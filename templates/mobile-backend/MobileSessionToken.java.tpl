package __PACKAGE__.mobilesupport;

import jakarta.persistence.*;

@Entity
@Table(name = "_uml_mobile_sessions")
public class MobileSessionToken {
    @Id @Column(length = 64)
    private String tokenHash;
    @Column(nullable = false, length = 120)
    private String username;
    @Column(nullable = false, length = 64)
    private String credentialVersion;
    protected MobileSessionToken() {}
    MobileSessionToken(String tokenHash, String username, String credentialVersion) {
        this.tokenHash = tokenHash;
        this.username = username;
        this.credentialVersion = credentialVersion;
    }
    boolean matches(String username, String version) {
        return this.username.equals(username) && credentialVersion.equals(version);
    }
}
