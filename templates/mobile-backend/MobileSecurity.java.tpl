package __PACKAGE__.mobilesupport;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Configuration
public class MobileSecurity {
    @Bean
    SecretKeySpec tokenKey(@Value("${AUTH_TOKEN_SECRET}") String secret) {
        if (secret.length() < 32) throw new IllegalArgumentException("AUTH_TOKEN_SECRET requiere al menos 32 caracteres.");
        return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }
    @Bean
    JwtDecoder jwtDecoder(SecretKeySpec key, MobileSessions sessions) {
        var decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        OAuth2TokenValidator<Jwt> validator = jwt -> sessions.accepts(jwt)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "Sesion revocada", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer("uml-mobile"), validator));
        return decoder;
    }
    @Bean
    JwtEncoder jwtEncoder(SecretKeySpec key) { return new NimbusJwtEncoder(new ImmutableSecret<>(key)); }
    @Bean
    SecurityFilterChain security(HttpSecurity http) throws Exception {
        return http.csrf(csrf -> csrf.disable()).cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/session/login", "/session/refresh", "/session/logout", "/actuator/health", "/error", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults())).build();
    }
}

@RestController
class MobileSessionController {
    private final MobileSessions sessions;
    MobileSessionController(MobileSessions sessions) { this.sessions = sessions; }
    record Credentials(String username, String password) {}
    record Refresh(String refreshToken) {}
    @PostMapping("/session/login")
    public MobileSessions.Session login(@RequestBody Credentials body) { return sessions.login(body.username(), body.password()); }
    @PostMapping("/session/refresh")
    public MobileSessions.Session refresh(@RequestBody Refresh body) { return sessions.refresh(body.refreshToken()); }
    @PostMapping("/session/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestBody Refresh body) { sessions.logout(body.refreshToken()); }
}
