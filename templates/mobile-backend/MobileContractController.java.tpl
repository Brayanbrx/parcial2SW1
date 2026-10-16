package __PACKAGE__.mobilesupport;

import java.io.IOException;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Versioned contract used by the reusable Android client after authentication. */
@RestController
public class MobileContractController {
    private final JsonNode contract;
    public MobileContractController(ObjectMapper json) throws IOException {
        try (var input = new ClassPathResource("mobile-contract.json").getInputStream()) {
            contract = json.readTree(input);
        }
    }
    @GetMapping("/mobile-contract")
    public Map<String, Object> contract() {
        return Map.of("protocolVersion", 1, "contract", contract);
    }
}
