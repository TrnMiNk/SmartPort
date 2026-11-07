
package smartport_m1m.m1.dto;

import java.math.BigDecimal;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import smartport_m1m.m1.validation.ValidImo;

public record CreateVesselRequest(

    @NotBlank(message = "Ma tau khong duoc de trong")
    @Size(max = 50)
    String shipCode,

    @NotBlank(message = "Ten tau khong duoc de trong")
    @Size(max = 100)
    String shipName,

    @NotBlank(message = "So IMO khong duoc de trong")
    @ValidImo
    String imoNumber,

    @NotBlank(message = "Loai tau khong duoc de trong")
    String shipType,

    @NotNull(message = "Trong tai khong duoc de trong")
    @Positive(message = "Trong tai phai lon hon 0")
    BigDecimal capacity,

    @NotNull(message = "Chieu dai khong duoc de trong")
    @Positive(message = "Chieu dai phai lon hon 0")
    BigDecimal lengthOverall,

    @NotNull(message = "Mon nuoc khong duoc de trong")
    @Positive(message = "Mon nuoc phai lon hon 0")
    BigDecimal draft

) {}
