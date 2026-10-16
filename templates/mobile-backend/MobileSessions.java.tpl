package __PACKAGE__.mobilesupport;

import jakarta.persistence.EntityManager;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Persistent per-device sessions. Only a SHA-256 digest of the refresh secret is stored. */
@Service
public class MobileSessions {
    private final EntityManager em;
    private final JwtEncoder encoder;
    private final String username, passwordHash, credentialVersion;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();
    private long windowStart;
    private int failures;

    public MobileSessions(EntityManager em, JwtEncoder encoder, SecretKeySpec key,
            @Value("${AUTH_USERNAME:admin}") String username,
            @Value("${AUTH_PASSWORD:admin}") String password) {
        boolean seed = username.equals("admin") && password.equals("admin");
        if (username.isBlank() || username.length() > 120 || (!seed && password.length() < 12)
                || password.getBytes(StandardCharsets.UTF_8).length > 72)
            throw new IllegalArgumentException("Usa admin/admin para la semilla o una contraseña propia de 12 caracteres minimo y 72 bytes maximo.");
        this.em = em;
        this.encoder = encoder;
        this.username = username;
        this.passwordHash = passwords.encode(password);
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            this.credentialVersion = HexFormat.of().formatHex(mac.doFinal((username + "\0" + password).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    public record Session(String accessToken, String username, long expiresAt, String refreshToken) {}

    @Transactional
    public synchronized Session login(String name, String password) {
        long now = Instant.now().getEpochSecond();
        if (now - windowStart >= 60) { windowStart = now; failures = 0; }
        if (failures >= 10) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Espera un minuto antes de reintentar.");
        boolean valid = password != null && password.getBytes(StandardCharsets.UTF_8).length <= 72 && passwords.matches(password, passwordHash);
        if (!username.equals(name) || !valid) {
            failures++;
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Credenciales incorrectas.");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String refresh = HexFormat.of().formatHex(bytes);
        em.persist(new MobileSessionToken(digest(refresh), username, credentialVersion));
        return issue(refresh);
    }

    @Transactional(readOnly = true)
    public Session refresh(String token) {
        if (!validToken(token)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "La sesion fue cerrada o las credenciales cambiaron. Inicia sesion nuevamente.");
        // Stable refresh token permits retries after a lost response and long offline periods.
        return issue(token);
    }

    @Transactional
    public void logout(String token) {
        if (!wellFormed(token)) return;
        var stored = em.find(MobileSessionToken.class, digest(token));
        if (stored != null) em.remove(stored);
    }

    @Transactional(readOnly = true)
    public boolean accepts(Jwt jwt) {
        String id = jwt.getClaimAsString("sid");
        if (!username.equals(jwt.getSubject()) || id == null || !id.matches("[0-9a-f]{64}")) return false;
        var stored = em.find(MobileSessionToken.class, id);
        return stored != null && stored.matches(username, credentialVersion);
    }

    private boolean validToken(String token) {
        if (!wellFormed(token)) return false;
        var stored = em.find(MobileSessionToken.class, digest(token));
        return stored != null && stored.matches(username, credentialVersion);
    }
    private static boolean wellFormed(String token) { return token != null && token.matches("[0-9a-f]{64}"); }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
    private Session issue(String refresh) {
        var now = Instant.now();
        var expires = now.plusSeconds(900);
        var claims = JwtClaimsSet.builder().issuer("uml-mobile").subject(username)
                .claim("sid", digest(refresh)).issuedAt(now).expiresAt(expires).build();
        var header = JwsHeader.with(MacAlgorithm.HS256).build();
        return new Session(encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue(), username, expires.getEpochSecond(), refresh);
    }
}
